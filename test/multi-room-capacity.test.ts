import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";

import { composeExamPlan } from "../src/core/exam-composer.ts";
import { FUNCTION_CATALOG } from "../src/core/function-catalog.ts";
import { auditExamPublication } from "../src/core/question-publication-gate.ts";
import { InMemoryStudentExamRepository } from "../src/server/student-exam-repository.ts";

test("four rooms can prepare and admit 200 students each without cross-room state leakage", async (context) => {
  const repository: any = new InMemoryStudentExamRepository();
  const composition: any = composeExamPlan({
    mode: "exam",
    difficulty: "easy",
    selectedFunctions: FUNCTION_CATALOG.map((definition) => definition.name),
  });
  const publicationAudit: any = auditExamPublication({ plan: composition.plan, warnings: composition.warnings });
  const roster: any = Array.from({ length: 200 }, (_, index) => ({
    studentNumber: `LOAD-${String(index + 1).padStart(3, "0")}`,
    name: `Student ${index + 1}`,
  }));
  const startedAt: any = performance.now();
  const exams: any = await Promise.all(Array.from({ length: 4 }, (_, index) => repository.publishExam({
    title: `Capacity room ${index + 1}`,
    mode: "exam",
    selectedFunctions: composition.plan.coverage.selected,
    plan: composition.plan,
    publicationAudit,
    roster,
    createdByLogin: "capacity-test",
  })));

  await Promise.all(exams.map(async (exam: any) => {
    let preparation;
    do {
      preparation = await repository.prepareNextBatch({ examCode: exam.code, batchSize: 25 });
    } while (preparation.status === "generating");
    assert.equal(preparation.status, "ready", exam.code);
    assert.equal(preparation.generatedQuestionCount, 8_000, exam.code);
  }));

  const admissions: any = await Promise.all(exams.map(async (exam: any) => {
    await Promise.all(roster.map((student: any) => repository.verifyIdentity({
      examCode: exam.code,
      studentNumber: student.studentNumber,
    })));
    return repository.admitWaitingStudents({ examCode: exam.code });
  }));
  assert.deepEqual(admissions.map((result: any) => result.admittedCount), [200, 200, 200, 200]);

  const starts: any = await Promise.all(exams.flatMap((exam: any) => roster.map((student: any) => repository.startAttempt({
    examCode: exam.code,
    studentNumber: student.studentNumber,
    sessionTokenHash: `${exam.code}:${student.studentNumber}`,
    browserPreflight: { fullscreen: true },
  }))));
  assert.equal(starts.length, 800);
  assert.equal(starts.every((attempt: any) => attempt.questions.length === 40), true);
  assert.equal(new Set(starts.map((attempt: any) => attempt.id)).size, 800);

  const elapsedMs: any = performance.now() - startedAt;
  context.diagnostic(`prepared 32,000 questions and started 800 isolated attempts in ${Math.round(elapsedMs)} ms`);
  assert.equal(elapsedMs < 30_000, true, `multi-room capacity run exceeded 30 seconds: ${Math.round(elapsedMs)} ms`);
});
