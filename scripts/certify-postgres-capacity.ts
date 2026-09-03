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

const connectionString = process.env["DATABASE_URL"];
if (!connectionString) throw new Error("DATABASE_URL is required.");
if (process.env["CAPACITY_CERTIFICATION_CONFIRM"] !== "TEMPORARY_BRANCH_ONLY") {
  throw new Error("Capacity certification is destructive test data. Use a temporary branch and set CAPACITY_CERTIFICATION_CONFIRM=TEMPORARY_BRANCH_ONLY.");
}

const roomCount = positiveInteger(process.env["CAPACITY_ROOM_COUNT"], 4, 8);
const studentsPerRoom = positiveInteger(process.env["CAPACITY_STUDENTS_PER_ROOM"], 200, 200);
const databasePoolMax = positiveInteger(process.env["DATABASE_POOL_MAX"], 4, 10);
const runId = Date.now().toString(36).toUpperCase();
const repository: any = new PostgresStudentExamRepository({ connectionString, databasePoolMax });

try {
  const composition = composeExamPlan({
    mode: "exam",
    difficulty: "easy",
    selectedFunctions: FUNCTION_CATALOG.map((definition) => definition.name),
  });
  assert.equal(composition.ok, true, JSON.stringify(composition.errors));
  if (!composition.ok) throw new Error("CAPACITY_COMPOSITION_FAILED");
  const publicationAudit = auditExamPublication({ plan: composition.plan, warnings: composition.warnings });
  assert.equal(publicationAudit.ok, true, JSON.stringify(publicationAudit.errors));

  const roomDefinitions = Array.from({ length: roomCount }, (_, roomIndex) => ({
    roomIndex,
    roster: Array.from({ length: studentsPerRoom }, (_, studentIndex) => ({
      studentNumber: `C${runId}${roomIndex + 1}${String(studentIndex + 1).padStart(3, "0")}`,
      name: `Capacity ${runId} ${roomIndex + 1}-${studentIndex + 1}`,
    })),
  }));

  const startedAt = performance.now();
  const exams = await Promise.all(roomDefinitions.map(({ roomIndex, roster }) => repository.publishExam({
    title: `Capacity ${runId} room ${roomIndex + 1}`,
    mode: "exam",
    selectedFunctions: composition.plan["coverage"].selected,
    plan: composition.plan,
    publicationAudit,
    roster,
    createdByLogin: "capacity-certification",
  })));
  const publishedAt = performance.now();

  const preparation = await Promise.all(exams.map(async (exam) => {
    let current;
    do {
      current = await repository.prepareNextBatch({ examCode: exam.code, batchSize: 25 });
    } while (current?.status === "generating");
    assert.equal(current?.status, "ready", `${exam.code}: ${JSON.stringify(current)}`);
    assert.equal(current.generatedQuestionCount, studentsPerRoom * 50, exam.code);
    return current;
  }));
  const preparedAt = performance.now();

  const entries = exams.flatMap((exam: any, roomIndex: number) => roomDefinitions[roomIndex]!.roster.map((student) => ({ exam, student })));
  const verifications: any[] = await mapWithConcurrency(entries, databasePoolMax * 2, ({ exam, student }) => repository.verifyIdentity({
    examCode: exam.code,
    studentNumber: student.studentNumber,
  }));
  assert.equal(verifications.every((result) => result?.status === "waiting_approval"), true);

  const admissions = await Promise.all(exams.map((exam) => repository.admitWaitingStudents({
    examCode: exam.code,
    approvedByLogin: "capacity-certification",
  })));
  assert.equal(admissions.every((result) => result.admittedCount === studentsPerRoom), true);
  const admittedAt = performance.now();

  const attempts: any[] = await mapWithConcurrency(entries, databasePoolMax * 2, ({ exam, student }) => repository.startAttempt({
    examCode: exam.code,
    studentNumber: student.studentNumber,
    sessionTokenHash: `${exam.code}:${student.studentNumber}`,
    browserPreflight: { fullscreen: true },
  }));
  assert.equal(attempts.length, roomCount * studentsPerRoom);
  assert.equal(attempts.every((attempt) => attempt.questions.length === 50), true);
  assert.equal(new Set(attempts.map((attempt) => attempt.id)).size, attempts.length);
  const completedAt = performance.now();

  console.log(JSON.stringify({
    runId,
    roomCount,
    studentsPerRoom,
    candidateCount: entries.length,
    preparedQuestionCount: preparation.reduce((total: number, item: any) => total + item.generatedQuestionCount, 0),
    timingsMs: {
      publish: Math.round(publishedAt - startedAt),
      prepare: Math.round(preparedAt - publishedAt),
      verifyAndAdmit: Math.round(admittedAt - preparedAt),
      start: Math.round(completedAt - admittedAt),
      total: Math.round(completedAt - startedAt),
    },
    examCodes: exams.map((exam) => exam.code),
  }, null, 2));
} finally {
  await repository.close();
}
