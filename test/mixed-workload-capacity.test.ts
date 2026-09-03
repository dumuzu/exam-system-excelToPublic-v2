import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";

import { composeExamPlan } from "../src/core/exam-composer.ts";
import { FUNCTION_CATALOG } from "../src/core/function-catalog.ts";
import { auditExamPublication } from "../src/core/question-publication-gate.ts";
import { InMemoryStudentExamRepository } from "../src/server/student-exam-repository.ts";

async function mapWithConcurrency(values: any, concurrency: any, operation: any) {
  const results: any = new Array(values.length);
  let cursor: any = 0;
  const workers: any = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length) {
      const index: any = cursor;
      cursor += 1;
      results[index] = await operation(values[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

function roster(size: any) {
  return Array.from({ length: size }, (_, index) => ({
    studentNumber: `MIX-${String(index + 1).padStart(4, "0")}`,
    name: `Mixed load student ${index + 1}`,
  }));
}

async function prepareToReady(repository: any, examCode: any) {
  let preparation;
  do {
    preparation = await repository.prepareNextBatch({ examCode, batchSize: 25 });
  } while (preparation.status === "generating");
  assert.equal(preparation.status, "ready", `${examCode}: ${JSON.stringify(preparation)}`);
  return preparation;
}

test("two teachers can operate four 50-seat exams beside one 500-student classroom assignment", async (context) => {
  const repository: any = new InMemoryStudentExamRepository();
  const formalRoster: any = roster(50);
  const assignmentRoster: any = roster(500);
  const formalComposition: any = composeExamPlan({
    mode: "exam",
    difficulty: "easy",
    selectedFunctions: FUNCTION_CATALOG.map((definition) => definition.name),
  });
  const assignmentComposition: any = composeExamPlan({
    mode: "assignment",
    assignmentOptions: { questionsPerFunction: 5 },
    selectedFunctions: ["SUM", "AVERAGE", "IF"],
  });
  assert.equal(formalComposition.ok, true, JSON.stringify(formalComposition.errors));
  assert.equal(assignmentComposition.ok, true, JSON.stringify(assignmentComposition.errors));
  const formalAudit: any = auditExamPublication({ plan: formalComposition.plan, warnings: formalComposition.warnings });
  const assignmentAudit: any = auditExamPublication({ plan: assignmentComposition.plan, warnings: assignmentComposition.warnings });
  assert.equal(formalAudit.ok, true, JSON.stringify(formalAudit.errors));
  assert.equal(assignmentAudit.ok, true, JSON.stringify(assignmentAudit.errors));

  const startedAt: any = performance.now();
  const formalExams: any = await Promise.all(Array.from({ length: 4 }, (_, roomIndex) => repository.publishExam({
    title: `Formal room ${roomIndex + 1}`,
    mode: "exam",
    selectedFunctions: formalComposition.plan.coverage.selected,
    plan: formalComposition.plan,
    publicationAudit: formalAudit,
    roster: formalRoster,
    createdByLogin: roomIndex % 2 === 0 ? "super_admin" : "test_admin",
  })));
  const assignmentExam: any = await repository.publishExam({
    title: "Shared classroom practice",
    mode: "assignment",
    selectedFunctions: assignmentComposition.plan.coverage.selected,
    plan: assignmentComposition.plan,
    publicationAudit: assignmentAudit,
    roster: assignmentRoster,
    createdByLogin: "super_admin",
  });
  assert.equal(new Set([...formalExams, assignmentExam].map((exam) => exam.code)).size, 5);

  const preparations: any = await Promise.all([
    ...formalExams.map((exam: any) => prepareToReady(repository, exam.code)),
    prepareToReady(repository, assignmentExam.code),
  ]);
  assert.deepEqual(preparations.slice(0, 4).map((item: any) => item.generatedQuestionCount), [2_000, 2_000, 2_000, 2_000]);
  assert.equal(preparations[4].generatedQuestionCount, 15);

  const formalEntries: any = formalExams.flatMap((exam: any) => formalRoster.map((student: any) => ({ exam, student })));
  const assignmentEntries: any = assignmentRoster.map((student: any) => ({ exam: assignmentExam, student }));
  const entries: any = [...formalEntries, ...assignmentEntries];
  const verified: any = await mapWithConcurrency(entries, 16, ({ exam, student }: any) => repository.verifyIdentity({
    examCode: exam.code,
    studentNumber: student.studentNumber,
  }));
  assert.equal(verified.filter((result: any) => result.status === "waiting_approval").length, 200);
  assert.equal(verified.filter((result: any) => result.status === "admitted").length, 500);
  const admissions: any = await Promise.all(formalExams.map((exam: any, index: any) => repository.admitWaitingStudents({
    examCode: exam.code,
    approvedByLogin: index % 2 === 0 ? "super_admin" : "test_admin",
  })));
  assert.deepEqual(admissions.map((result: any) => result.admittedCount), [50, 50, 50, 50]);

  const startResults: any = await Promise.all([
    mapWithConcurrency(entries, 16, ({ exam, student }: any) => repository.startAttempt({
      examCode: exam.code,
      studentNumber: student.studentNumber,
      sessionTokenHash: `${exam.code}:${student.studentNumber}`,
      browserPreflight: exam.mode === "exam" ? { fullscreen: true } : {},
    })),
    ...formalExams.map((exam: any) => repository.listAttendance(exam.code)),
    repository.listAttendance(assignmentExam.code),
  ]);
  const attempts: any = startResults[0];
  assert.equal(attempts.length, 700);
  assert.equal(new Set(attempts.map((attempt: any) => attempt.id)).size, 700);
  assert.equal(attempts.slice(0, 200).every((attempt: any) => attempt.questions.length === 40), true);
  assert.equal(attempts.slice(200).every((attempt: any) => attempt.questions.length === 15), true);
  assert.deepEqual(attempts[200].questions, attempts.at(-1).questions);

  const firstAssignmentSubmissions: any = await mapWithConcurrency(assignmentEntries, 16, ({ exam, student }: any) => repository.submitAttempt({
    examCode: exam.code,
    studentNumber: student.studentNumber,
    sessionTokenHash: `${exam.code}:${student.studentNumber}`,
    answers: {},
  }));
  assert.equal(firstAssignmentSubmissions.every((submission: any) => submission.attemptNumber === 1), true);
  assert.equal(firstAssignmentSubmissions.every((submission: any) => submission.attemptsRemaining === 1), true);

  const secondWave: any = assignmentEntries.slice(0, 50);
  await mapWithConcurrency(secondWave, 16, ({ exam, student }: any) => repository.verifyIdentity({
    examCode: exam.code,
    studentNumber: student.studentNumber,
  }));
  const secondAttempts: any = await mapWithConcurrency(secondWave, 16, ({ exam, student }: any) => repository.startAttempt({
    examCode: exam.code,
    studentNumber: student.studentNumber,
    sessionTokenHash: `${exam.code}:${student.studentNumber}:second`,
  }));
  assert.equal(secondAttempts.every((attempt: any) => attempt.attemptNumber === 2), true);
  assert.deepEqual(secondAttempts[0].questions, attempts[200].questions);
  const secondSubmissions: any = await mapWithConcurrency(secondWave, 16, ({ exam, student }: any) => repository.submitAttempt({
    examCode: exam.code,
    studentNumber: student.studentNumber,
    sessionTokenHash: `${exam.code}:${student.studentNumber}:second`,
    answers: {},
  }));
  assert.equal(secondSubmissions.every((submission: any) => submission.attemptNumber === 2), true);
  assert.equal(secondSubmissions.every((submission: any) => submission.attemptsRemaining === 0), true);

  const roomSnapshots: any = await Promise.all([
    ...formalExams.map((exam: any) => repository.listAttendance(exam.code)),
    repository.listAttendance(assignmentExam.code),
  ]);
  assert.deepEqual(roomSnapshots.slice(0, 4).map((students: any) => students.length), [50, 50, 50, 50]);
  assert.equal(roomSnapshots[4].length, 500);
  assert.equal(roomSnapshots[4].filter((student: any) => student.attemptCount === 2).length, 50);
  assert.equal(roomSnapshots[4].filter((student: any) => student.attemptCount === 1).length, 450);
  assert.equal(roomSnapshots.slice(0, 4).flat().every((student: any) => student.status === "in_progress"), true);

  const elapsedMs: any = performance.now() - startedAt;
  context.diagnostic(JSON.stringify({
    formalRooms: 4,
    formalStudents: 200,
    assignmentRoster: 500,
    attemptsStarted: 750,
    assignmentSubmissions: 550,
    preparedQuestionRecords: 8_015,
    elapsedMs: Math.round(elapsedMs),
  }));
  assert.equal(elapsedMs < 30_000, true, `mixed workload certification exceeded 30 seconds: ${Math.round(elapsedMs)} ms`);
});
