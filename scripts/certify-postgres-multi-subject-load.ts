import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
import { randomUUID } from "node:crypto";

import { composeExamPlan } from "../src/core/exam-composer.ts";
import { FUNCTION_CATALOG } from "../src/core/function-catalog.ts";
import { auditExamPublication } from "../src/core/question-publication-gate.ts";
import {
  ADMIN_ROLES,
  createAdminSession,
  hashAdminPassword,
  verifyPersistedAdminCredentials,
} from "../src/server/admin-auth.ts";
import { authorizeTeacherAction } from "../src/server/authorization-policy.ts";
import { PostgresStudentExamRepository } from "../src/server/student-exam-repository.ts";
import { PostgresTeacherAccountRepository } from "../src/server/teacher-account-repository.ts";

const require = createRequire(import.meta.url);
const { Pool } = require("pg") as { Pool: new (options: Record<string, unknown>) => any };

interface MetricSummary {
  count: number;
  minimumMs: number;
  medianMs: number;
  p95Ms: number;
  maximumMs: number;
}

interface CollectionResult {
  completed: boolean;
  failedSubmissionCount: number;
  pendingSubmissionCount: number;
}

class Metrics {
  readonly #durations = new Map<string, number[]>();

  async measure<Result>(name: string, operation: () => Promise<Result>): Promise<Result> {
    const startedAt = performance.now();
    try {
      return await operation();
    } finally {
      const durations = this.#durations.get(name) ?? [];
      durations.push(performance.now() - startedAt);
      this.#durations.set(name, durations);
    }
  }

  summary(): Record<string, MetricSummary> {
    return Object.fromEntries([...this.#durations].map(([name, values]) => {
      const sorted = [...values].sort((left, right) => left - right);
      const percentile = (ratio: number) => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)] ?? 0;
      return [name, {
        count: sorted.length,
        minimumMs: Math.round(sorted[0] ?? 0),
        medianMs: Math.round(percentile(0.5)),
        p95Ms: Math.round(percentile(0.95)),
        maximumMs: Math.round(sorted.at(-1) ?? 0),
      }];
    }));
  }
}

function positiveInteger(value: string | undefined, fallback: number, maximum: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= maximum ? parsed : fallback;
}

async function mapWithConcurrency<Value, Result>(
  values: readonly Value[],
  concurrency: number,
  operation: (value: Value, index: number) => Promise<Result>,
): Promise<Result[]> {
  const results = new Array<Result>(values.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await operation(values[index]!, index);
    }
  }));
  return results;
}

async function prepareToReady(repository: PostgresStudentExamRepository, examCode: string, metrics: Metrics): Promise<any> {
  let preparation: any;
  do {
    preparation = await metrics.measure("preparationBatch", () => repository.prepareNextBatch({ examCode, batchSize: 25 }));
  } while (preparation?.status === "generating");
  assert.equal(preparation?.status, "ready", `${examCode}: ${JSON.stringify(preparation)}`);
  return preparation;
}

const connectionString = process.env["CAPACITY_TEST_DATABASE_URL"];
if (!connectionString) {
  throw new Error("CAPACITY_TEST_DATABASE_URL is required. Production DATABASE_URL is intentionally ignored.");
}
if (process.env["CAPACITY_CERTIFICATION_CONFIRM"] !== "TEMPORARY_BRANCH_ONLY") {
  throw new Error("This certification writes persistent test data. Use a disposable branch and set CAPACITY_CERTIFICATION_CONFIRM=TEMPORARY_BRANCH_ONLY.");
}

const teacherCount = 5;
const rosterSize = positiveInteger(process.env["CAPACITY_STUDENTS_PER_SUBJECT"], 200, 200);
const activePerSubject = Math.min(rosterSize, positiveInteger(process.env["CAPACITY_ACTIVE_PER_SUBJECT"], 40, 200));
const manualSubmissionsPerSubject = Math.min(activePerSubject, positiveInteger(process.env["CAPACITY_MANUAL_SUBMISSIONS_PER_SUBJECT"], 10, 200));
const databasePoolMax = positiveInteger(process.env["DATABASE_POOL_MAX"], 4, 10);
const requestConcurrency = positiveInteger(process.env["CAPACITY_REQUEST_CONCURRENCY"], databasePoolMax * 2, 32);
const sessionSecret = process.env["CAPACITY_SESSION_SECRET"] ?? "temporary-capacity-certification-session-secret";
const runId = Date.now().toString(36).toLowerCase();
const password = `Capacity-${runId}-teacher-password`;
const passwordHash = hashAdminPassword(password);
const metrics = new Metrics();
const seedPool = new Pool({ connectionString, max: 1, allowExitOnIdle: true });
const definitions = Array.from({ length: teacherCount }, (_, index) => ({
  accountId: randomUUID(),
  membershipId: randomUUID(),
  subjectId: randomUUID(),
  username: `capacity-${runId}-teacher-${index + 1}`,
  subjectCode: `capacity-${runId}-${index + 1}`,
  subjectName: `Capacity ${runId} subject ${index + 1}`,
}));

try {
  await seedPool.query("BEGIN");
  const migration = await seedPool.query("SELECT max(version)::integer AS version FROM schema_migrations");
  assert.equal(migration.rows[0]?.version, 26, "Apply migrations 001-026 to the disposable branch before certification.");
  for (const definition of definitions) {
    await seedPool.query(
      "INSERT INTO teachers (id,login_name,display_name) VALUES ($1,$2,$3)",
      [definition.accountId, definition.username, definition.username],
    );
    await seedPool.query(
      `INSERT INTO teacher_accounts (id,password_hash,platform_role,account_status,activated_at)
       VALUES ($1,$2,'teacher','active',CURRENT_TIMESTAMP)`,
      [definition.accountId, passwordHash],
    );
    await seedPool.query(
      `INSERT INTO subjects (id,subject_code,name_ja,name_zh,assessment_type_key,subject_status,created_by_account_id)
       VALUES ($1,$2,$3,$3,'excel_formula','active',$4)`,
      [definition.subjectId, definition.subjectCode, definition.subjectName, definition.accountId],
    );
    await seedPool.query(
      `INSERT INTO subject_memberships (id,subject_id,account_id,subject_role,membership_status,granted_by_account_id)
       VALUES ($1,$2,$3,'teacher','active',$3)`,
      [definition.membershipId, definition.subjectId, definition.accountId],
    );
  }
  await seedPool.query("COMMIT");
} catch (error) {
  await seedPool.query("ROLLBACK");
  throw error;
} finally {
  await seedPool.end();
}

const teacherRepository = new PostgresTeacherAccountRepository({ connectionString, databasePoolMax });
const examRepository = new PostgresStudentExamRepository({ connectionString, databasePoolMax });
const startedAt = performance.now();

try {
  const sessions = await Promise.all(definitions.map(async (definition) => {
    const account = await metrics.measure("login", () => verifyPersistedAdminCredentials(
      { username: definition.username, password },
      teacherRepository,
    ));
    assert.ok(account);
    const memberships = await teacherRepository.listActiveSubjectMemberships(account.accountId);
    assert.deepEqual(memberships.map((membership) => membership.subjectId), [definition.subjectId]);
    const session = createAdminSession({ account, sessionSecret });
    return { definition, account, actor: { accountId: account.accountId, platformRole: account.role, memberships }, session };
  }));
  assert.equal(new Set(sessions.map(({ session }) => session.token)).size, teacherCount);

  const composition = composeExamPlan({
    mode: "exam",
    difficulty: "easy",
    selectedFunctions: FUNCTION_CATALOG.map((definition) => definition.name),
  });
  assert.equal(composition.ok, true, JSON.stringify(composition.errors));
  if (!composition.ok) throw new Error("CAPACITY_COMPOSITION_FAILED");
  const publicationAudit = auditExamPublication({ plan: composition.plan, warnings: composition.warnings });
  assert.equal(publicationAudit.ok, true, JSON.stringify(publicationAudit.errors));

  const rosters = definitions.map((definition, teacherIndex) => Array.from({ length: rosterSize }, (_, studentIndex) => ({
    studentNumber: `C${teacherIndex + 1}${runId.slice(-6).toUpperCase()}${String(studentIndex + 1).padStart(4, "0")}`,
    name: `Capacity ${runId} ${teacherIndex + 1}-${studentIndex + 1}`,
  })));
  const exams = await Promise.all(sessions.map(({ definition, account }, index) => metrics.measure("publish", () => examRepository.publishExam({
    title: definition.subjectName,
    mode: "exam",
    selectedFunctions: composition.plan["coverage"].selected,
    plan: composition.plan,
    publicationAudit,
    roster: rosters[index],
    createdByLogin: account.username,
    createdByAccountId: account.accountId,
    subjectId: definition.subjectId,
    assessmentTypeKey: "excel_formula",
  }))));
  assert.equal(new Set(exams.map((exam) => exam.code)).size, teacherCount);

  const preparations = await Promise.all(exams.map((exam) => prepareToReady(examRepository, exam.code, metrics)));
  assert.equal(preparations.every((preparation) => preparation.generatedQuestionCount === rosterSize * 40), true);

  const scopedLists = await Promise.all(sessions.map(({ actor }) => examRepository.listExamEvents({ authorization: actor, action: "view_room" })));
  assert.equal(scopedLists.every((events) => events.length === 1), true);
  assert.deepEqual(scopedLists.map((events) => events[0]!.subjectId), definitions.map((definition) => definition.subjectId));
  assert.equal(authorizeTeacherAction({
    actor: sessions[0]!.actor,
    action: "view_room",
    resource: { subjectId: definitions[1]!.subjectId, ownerAccountId: definitions[1]!.accountId, resourceType: "exam", resourceId: exams[1]!.code },
  }).allowed, false);

  const activeEntries = exams.flatMap((exam, teacherIndex) => rosters[teacherIndex]!
    .slice(0, activePerSubject)
    .map((student) => ({ exam, teacherIndex, student })));
  await mapWithConcurrency(activeEntries, requestConcurrency, ({ exam, student }) => metrics.measure("identityVerification", () =>
    examRepository.verifyIdentity({ examCode: exam.code, studentNumber: student.studentNumber })));
  await Promise.all(exams.map((exam, index) => metrics.measure("admission", () => examRepository.admitWaitingStudents({
    examCode: exam.code,
    approvedByLogin: definitions[index]!.username,
  }))));

  const attempts = await mapWithConcurrency(activeEntries, requestConcurrency, ({ exam, student }) => metrics.measure("attemptStart", () =>
    examRepository.startAttempt({
      examCode: exam.code,
      studentNumber: student.studentNumber,
      sessionTokenHash: `${exam.code}:${student.studentNumber}:session`,
      browserPreflight: { fullscreen: true },
    })));
  assert.equal(new Set(attempts.map((attempt) => attempt.id)).size, activeEntries.length);
  const retryProbe = await examRepository.startAttempt({
    examCode: activeEntries[0]!.exam.code,
    studentNumber: activeEntries[0]!.student.studentNumber,
    sessionTokenHash: `${activeEntries[0]!.exam.code}:${activeEntries[0]!.student.studentNumber}:session`,
    browserPreflight: { fullscreen: true },
  });
  assert.equal(retryProbe.id, attempts[0]!.id, "Attempt start retry must be idempotent.");

  await mapWithConcurrency(activeEntries, requestConcurrency, async ({ exam, student }, index) => {
    const identity = {
      examCode: exam.code,
      studentNumber: student.studentNumber,
      sessionTokenHash: `${exam.code}:${student.studentNumber}:session`,
    };
    const heartbeat = await metrics.measure("heartbeat", () => examRepository.heartbeat(identity));
    assert.equal(heartbeat?.status, "active");
    const answer = await metrics.measure("autosave", () => examRepository.saveAnswer({
      ...identity,
      questionKey: attempts[index]!.questions[0].key,
      formula: "=1",
      expectedVersion: 0,
    }));
    assert.equal(answer.version, 1);
  });

  const manualEntries = activeEntries.filter((_, index) => index % activePerSubject < manualSubmissionsPerSubject);
  await mapWithConcurrency(manualEntries, requestConcurrency, ({ exam, student }) => metrics.measure("submission", () =>
    examRepository.submitAttempt({
      examCode: exam.code,
      studentNumber: student.studentNumber,
      sessionTokenHash: `${exam.code}:${student.studentNumber}:session`,
      answers: {},
      manualConfirmationVerified: true,
    })));

  await mapWithConcurrency(exams, databasePoolMax, async (exam, index) => {
    const requestedAt = new Date();
    await metrics.measure("collectionRequest", () => examRepository.requestExamTermination({
      examCode: exam.code,
      requestedByLogin: definitions[index]!.username,
      now: requestedAt,
      collectionSeconds: 3,
    }));
    let result: CollectionResult | null = null;
    do {
      result = await metrics.measure("collection", () => examRepository.terminateExam({
        examCode: exam.code,
        terminatedByLogin: definitions[index]!.username,
        now: new Date(requestedAt.getTime() + 3_100),
      }));
      assert.equal(result?.failedSubmissionCount, 0);
    } while (!result?.completed);
    assert.equal(result?.completed, true);
    assert.equal(result?.pendingSubmissionCount, 0);
  });

  const resultSets = await Promise.all(exams.map((exam) => metrics.measure("resultRead", () => examRepository.listResults(exam.code))));
  for (const results of resultSets) {
    assert.equal(results?.length, rosterSize);
    assert.equal(results?.filter((result) => result.gradingStatus === "graded").length, activePerSubject);
  }
  const roomSnapshots = await Promise.all(exams.map((exam) => metrics.measure("roomPoll", () => examRepository.listAttendance(exam.code))));
  assert.equal(roomSnapshots.every((students) => students?.length === rosterSize), true);

  const metricSummary = metrics.summary();
  const p95BudgetsMs: Record<string, number> = {
    login: 2_000,
    roomPoll: 5_000,
    heartbeat: 5_000,
    autosave: 5_000,
    submission: 10_000,
    collection: 30_000,
    resultRead: 5_000,
  };
  for (const [operation, budget] of Object.entries(p95BudgetsMs)) {
    assert.ok(metricSummary[operation], `Missing required metric: ${operation}`);
    assert.equal(metricSummary[operation]!.p95Ms <= budget, true, `${operation} p95 exceeds ${budget} ms`);
  }

  console.log(JSON.stringify({
    runId,
    profile: {
      teacherSessions: teacherCount,
      independentSubjects: teacherCount,
      rosterSizePerSubject: rosterSize,
      activePerSubject,
      activeCandidates: activeEntries.length,
      manualSubmissionsPerSubject,
      requestConcurrency,
      databasePoolMaxPerRepository: databasePoolMax,
      certificationRepositoryPoolUpperBound: databasePoolMax * 2,
      productionThreeRepositoryPoolUpperBound: databasePoolMax * 3,
    },
    integrity: {
      uniqueAttempts: attempts.length,
      submittedOrCollected: activeEntries.length,
      crossSubjectAccessDenied: true,
      idempotentAttemptStart: true,
      failedCollections: 0,
    },
    metrics: metricSummary,
    p95BudgetsMs,
    totalMs: Math.round(performance.now() - startedAt),
    examCodes: exams.map((exam) => exam.code),
  }, null, 2));
} finally {
  await Promise.all([teacherRepository.close(), examRepository.close()]);
}
