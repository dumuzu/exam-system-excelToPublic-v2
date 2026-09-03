import assert from "node:assert/strict";
import test from "node:test";
import { composeExamPlan } from "../src/core/exam-composer.ts";
import { FUNCTION_CATALOG } from "../src/core/function-catalog.ts";
import { InMemoryStudentExamRepository } from "../src/server/student-exam-repository.ts";

test("preparation worker generates and validates 200 individual 50-question papers in bounded batches", async () => {
  const repository: any = new InMemoryStudentExamRepository();
  const plan: any = composeExamPlan({ mode: "exam", selectedFunctions: FUNCTION_CATALOG.map((item) => item.name) }).plan;
  const roster: any = Array.from({ length: 200 }, (_, index) => ({ studentNumber: `S${String(index + 1).padStart(4, "0")}`, name: `Student ${index + 1}` }));
  const exam: any = await repository.publishExam({ title: "Capacity", mode: "exam", selectedFunctions: plan.coverage.selected, plan, roster, createdByLogin: "admin" });
  let preparation;
  for (let index: any = 0; index < 8; index += 1) preparation = await repository.prepareNextBatch({ examCode: exam.code, batchSize: 25 });
  assert.deepEqual({ status: preparation.status, percent: preparation.percent, generated: preparation.generatedQuestionCount }, { status: "ready", percent: 100, generated: 10_000 });
  await repository.verifyIdentity({ examCode: exam.code, studentNumber: "S0001", name: "Student 1" });
  await repository.admitStudent({ examCode: exam.code, studentNumber: "S0001" });
  const attempt: any = await repository.startAttempt({ examCode: exam.code, studentNumber: "S0001", sessionTokenHash: "session-one", browserPreflight: { fullscreen: true } });
  assert.equal(attempt.questions.length, 50);
  const second: any = attempt.questions[1];
  const saved: any = await repository.saveAnswer({ examCode: exam.code, studentNumber: "S0001", sessionTokenHash: "session-one", questionKey: second.key, formula: "=TEST", expectedVersion: 0 });
  assert.equal(saved.version, 1);
  assert.equal((await repository.getAttempt({ examCode: exam.code, studentNumber: "S0001", sessionTokenHash: "session-one" })).answers.values[second.key], "=TEST");
  await repository.submitAttempt({
    examCode: exam.code,
    studentNumber: "S0001",
    sessionTokenHash: "session-one",
    manualConfirmationVerified: true,
  });
  const submitted: any = await repository.getAttempt({ examCode: exam.code, studentNumber: "S0001", sessionTokenHash: "session-one" });
  assert.equal(submitted.questions.length, 0);
  assert.equal(submitted.answers, null);
  const result: any = (await repository.listResults(exam.code)).find((item: any) => item.studentNumber === "S0001");
  assert.equal(result.gradingStatus, "graded");
  assert.equal(result.score, 0);
  assert.equal(result.choiceTotal, 0);
  assert.equal(result.formulaTotal, 50);
  assert.equal((await repository.getResult({ examCode: exam.code, studentNumber: "S0001" })).questions.length, 50);
  await repository.authorizeRetake({ examCode: exam.code, studentNumber: "S0001", authorizedByLogin: "admin" });
  const retake: any = await repository.startAttempt({ examCode: exam.code, studentNumber: "S0001", sessionTokenHash: "session-two", browserPreflight: { fullscreen: true } });
  assert.equal(retake.questions.length, 50);
  assert.deepEqual(retake.questions, attempt.questions);
  assert.deepEqual(retake.answers.values, {});
});
