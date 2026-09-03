import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";

import { composeExamPlan } from "../src/core/exam-composer.ts";
import { FUNCTION_CATALOG } from "../src/core/function-catalog.ts";
import { auditExamPublication } from "../src/core/question-publication-gate.ts";
import { PostgresStudentExamRepository } from "../src/server/student-exam-repository.ts";

function positiveInteger(value: string | undefined, fallback: number, maximum: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= maximum ? parsed : fallback;
}

async function mapWithConcurrency<Value, Result>(values: readonly Value[], concurrency: number, operation: (value: Value, index: number) => Promise<Result>): Promise<Result[]> {
  const results = new Array<Result>(values.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await operation(values[index]!, index);
    }
  });
  await Promise.all(workers);
  return results;
}

function isTransientDatabaseDisconnect(error: unknown): boolean {
  const candidate = error && typeof error === "object" ? error as { code?: unknown; message?: unknown } : {};
  const code = String(candidate.code ?? "").toUpperCase();
  return new Set(["08000", "08001", "08003", "08004", "08006", "57P01", "57P02", "57P03", "ECONNRESET"]).has(code)
    || /connection (?:terminated|closed|reset)|socket hang up/i.test(String(candidate.message ?? ""));
}

async function retryTransient<Result>(operation: () => Promise<Result>, maximumAttempts = 2): Promise<Result> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt >= maximumAttempts || !isTransientDatabaseDisconnect(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw lastError;
}

async function prepareToReady(repository: any, examCode: string): Promise<any> {
  let preparation: any;
  do {
    preparation = await retryTransient(
      () => repository.prepareNextBatch({ examCode, batchSize: 25 }),
    );
  } while (preparation?.status === "generating");
  assert.equal(preparation?.status, "ready", `${examCode}: ${JSON.stringify(preparation)}`);
  return preparation;
}

const connectionString = process.env["CAPACITY_TEST_DATABASE_URL"];
if (!connectionString) throw new Error("CAPACITY_TEST_DATABASE_URL is required. Production DATABASE_URL is intentionally ignored.");
if (process.env["CAPACITY_CERTIFICATION_CONFIRM"] !== "TEMPORARY_BRANCH_ONLY") {
  throw new Error("Mixed-load certification writes test data. Use a disposable Neon branch and set CAPACITY_CERTIFICATION_CONFIRM=TEMPORARY_BRANCH_ONLY.");
}

const formalRoomCount = positiveInteger(process.env["CAPACITY_FORMAL_ROOM_COUNT"], 4, 8);
const formalStudentsPerRoom = positiveInteger(process.env["CAPACITY_FORMAL_STUDENTS_PER_ROOM"], 50, 200);
const assignmentStudentCount = positiveInteger(process.env["CAPACITY_ASSIGNMENT_STUDENT_COUNT"], 500, 500);
const assignmentActiveStudentCount = Math.min(
  assignmentStudentCount,
  positiveInteger(process.env["CAPACITY_ASSIGNMENT_ACTIVE_STUDENTS"], 50, 500),
);
const secondSubmissionCount = Math.min(
  assignmentActiveStudentCount,
  positiveInteger(process.env["CAPACITY_ASSIGNMENT_SECOND_SUBMISSIONS"], 10, 500),
);
const databasePoolMax = positiveInteger(process.env["DATABASE_POOL_MAX"], 4, 10);
const requestConcurrency = positiveInteger(process.env["CAPACITY_REQUEST_CONCURRENCY"], databasePoolMax * 2, 32);
const runId = Date.now().toString(36).toUpperCase();
const repository: any = new PostgresStudentExamRepository({ connectionString, databasePoolMax });

function makeRoster(size: number) {
  return Array.from({ length: size }, (_, index) => ({
    studentNumber: `MX${runId}${String(index + 1).padStart(4, "0")}`,
    name: `Mixed load ${runId} student ${index + 1}`,
  }));
}

try {
  const formalComposition = composeExamPlan({
    mode: "exam",
    difficulty: "easy",
    selectedFunctions: FUNCTION_CATALOG.map((definition) => definition.name),
  });
  const assignmentComposition = composeExamPlan({
    mode: "assignment",
    assignmentOptions: { questionsPerFunction: 5 },
    selectedFunctions: ["SUM", "AVERAGE", "IF"],
  });
  assert.equal(formalComposition.ok, true, JSON.stringify(formalComposition.errors));
  assert.equal(assignmentComposition.ok, true, JSON.stringify(assignmentComposition.errors));
  if (!formalComposition.ok || !assignmentComposition.ok) throw new Error("MIXED_LOAD_COMPOSITION_FAILED");
  const formalAudit = auditExamPublication({ plan: formalComposition.plan, warnings: formalComposition.warnings });
  const assignmentAudit = auditExamPublication({ plan: assignmentComposition.plan, warnings: assignmentComposition.warnings });
  assert.equal(formalAudit.ok, true, JSON.stringify(formalAudit.errors));
  assert.equal(assignmentAudit.ok, true, JSON.stringify(assignmentAudit.errors));

  const formalRoster = makeRoster(formalStudentsPerRoom);
  const assignmentRoster = makeRoster(assignmentStudentCount);
  const startedAt = performance.now();
  const formalExams = await Promise.all(Array.from({ length: formalRoomCount }, (_, roomIndex) => repository.publishExam({
    title: `Mixed certification ${runId} formal ${roomIndex + 1}`,
    mode: "exam",
    selectedFunctions: formalComposition.plan["coverage"].selected,
    plan: formalComposition.plan,
    publicationAudit: formalAudit,
    roster: formalRoster,
    createdByLogin: roomIndex % 2 === 0 ? "capacity-super-admin" : "capacity-test-admin",
  })));
  const assignmentExam = await repository.publishExam({
    title: `Mixed certification ${runId} assignment`,
    mode: "assignment",
    selectedFunctions: assignmentComposition.plan["coverage"].selected,
    plan: assignmentComposition.plan,
    publicationAudit: assignmentAudit,
    roster: assignmentRoster,
    createdByLogin: "capacity-super-admin",
  });
  const publishedAt = performance.now();

  const preparations = await Promise.all([
    ...formalExams.map((exam) => prepareToReady(repository, exam.code)),
    prepareToReady(repository, assignmentExam.code),
  ]);
  const preparedAt = performance.now();

  const formalEntries = formalExams.flatMap((exam) => formalRoster.map((student) => ({ exam, student })));
  const assignmentEntries = assignmentRoster
    .slice(0, assignmentActiveStudentCount)
    .map((student) => ({ exam: assignmentExam, student }));
  const entries = [...formalEntries, ...assignmentEntries];
  const verifications: any[] = await mapWithConcurrency(entries, requestConcurrency, ({ exam, student }) => retryTransient(
    () => repository.verifyIdentity({ examCode: exam.code, studentNumber: student.studentNumber }),
  ));
  assert.equal(verifications.filter((result) => result?.status === "waiting_approval").length, formalEntries.length);
  assert.equal(verifications.filter((result) => result?.status === "admitted").length, assignmentEntries.length);
  const admissions: any[] = await Promise.all(formalExams.map((exam, index) => retryTransient(
    () => repository.admitWaitingStudents({
      examCode: exam.code,
      approvedByLogin: index % 2 === 0 ? "capacity-super-admin" : "capacity-test-admin",
    }),
  )));
  assert.equal(admissions.every((result) => result.admittedCount === formalStudentsPerRoom), true);
  const admittedAt = performance.now();

  const attempts: any[] = await mapWithConcurrency(entries, requestConcurrency, ({ exam, student }) => retryTransient(
    () => repository.startAttempt({
      examCode: exam.code,
      studentNumber: student.studentNumber,
      sessionTokenHash: `${exam.code}:${student.studentNumber}:first`,
      browserPreflight: exam.mode === "exam" ? { fullscreen: true } : {},
    }),
  ));
  assert.equal(attempts.length, entries.length);
  assert.equal(new Set(attempts.map((attempt) => attempt.id)).size, entries.length);
  assert.equal(attempts.slice(0, formalEntries.length).every((attempt) => attempt.questions.length === 40), true);
  assert.equal(attempts.slice(formalEntries.length).every((attempt) => attempt.questions.length === 15), true);
  assert.deepEqual(attempts[formalEntries.length].questions, attempts.at(-1).questions);
  const attemptsStartedAt = performance.now();

  const firstSubmissions: any[] = await mapWithConcurrency(assignmentEntries, requestConcurrency, ({ exam, student }) => retryTransient(
    () => repository.submitAttempt({
      examCode: exam.code,
      studentNumber: student.studentNumber,
      sessionTokenHash: `${exam.code}:${student.studentNumber}:first`,
      answers: {},
    }),
  ));
  assert.equal(firstSubmissions.every((submission) => submission.attemptNumber === 1 && submission.attemptsRemaining === 1), true);
  const secondEntries = assignmentEntries.slice(0, secondSubmissionCount);
  await mapWithConcurrency(secondEntries, requestConcurrency, ({ exam, student }) => retryTransient(
    () => repository.verifyIdentity({ examCode: exam.code, studentNumber: student.studentNumber }),
  ));
  const secondAttempts: any[] = await mapWithConcurrency(secondEntries, requestConcurrency, ({ exam, student }) => retryTransient(
    () => repository.startAttempt({
      examCode: exam.code,
      studentNumber: student.studentNumber,
      sessionTokenHash: `${exam.code}:${student.studentNumber}:second`,
    }),
  ));
  assert.equal(secondAttempts.every((attempt) => attempt.attemptNumber === 2), true);
  const secondSubmissions: any[] = await mapWithConcurrency(secondEntries, requestConcurrency, ({ exam, student }) => retryTransient(
    () => repository.submitAttempt({
      examCode: exam.code,
      studentNumber: student.studentNumber,
      sessionTokenHash: `${exam.code}:${student.studentNumber}:second`,
      answers: {},
    }),
  ));
  assert.equal(secondSubmissions.every((submission) => submission.attemptNumber === 2 && submission.attemptsRemaining === 0), true);
  const submittedAt = performance.now();

  const roomSnapshots = await Promise.all([
    ...formalExams.map((exam) => retryTransient(() => repository.listAttendance(exam.code))),
    retryTransient(() => repository.listAttendance(assignmentExam.code)),
  ]) as any[][];
  assert.deepEqual(roomSnapshots.slice(0, formalRoomCount).map((students) => students.length), Array(formalRoomCount).fill(formalStudentsPerRoom));
  assert.equal(roomSnapshots.at(-1)!.length, assignmentStudentCount);
  assert.equal(roomSnapshots.at(-1)!.filter((student) => student.attemptCount === 2).length, secondSubmissionCount);
  const assignmentResults: any[] = await retryTransient(() => repository.listResults(assignmentExam.code));
  assert.equal(assignmentResults.length, assignmentStudentCount);
  const activeStudentNumbers = new Set(assignmentEntries.map(({ student }) => student.studentNumber));
  assert.equal(
    assignmentResults.filter((result) => activeStudentNumbers.has(result.studentNumber))
      .every((result) => result.gradingStatus === "graded"),
    true,
  );
  const verifiedAt = performance.now();

  console.log(JSON.stringify({
    runId,
    databasePoolMax,
    requestConcurrency,
    formalRoomCount,
    formalStudentsPerRoom,
    formalCandidateCount: formalEntries.length,
    assignmentStudentCount,
    assignmentActiveStudentCount,
    secondSubmissionCount,
    totalStartedAttempts: entries.length + secondSubmissionCount,
    totalAssignmentSubmissions: assignmentActiveStudentCount + secondSubmissionCount,
    preparedQuestionCount: preparations.reduce((total, item) => total + item.generatedQuestionCount, 0),
    timingsMs: {
      publish: Math.round(publishedAt - startedAt),
      prepare: Math.round(preparedAt - publishedAt),
      verifyAndAdmit: Math.round(admittedAt - preparedAt),
      start: Math.round(attemptsStartedAt - admittedAt),
      submit: Math.round(submittedAt - attemptsStartedAt),
      verifyResults: Math.round(verifiedAt - submittedAt),
      total: Math.round(verifiedAt - startedAt),
    },
    examCodes: [...formalExams, assignmentExam].map((exam) => exam.code),
  }, null, 2));
} finally {
  await repository.close();
}
