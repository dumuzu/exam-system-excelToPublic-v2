import assert from "node:assert/strict";
import test from "node:test";

import { composeExamPlan } from "../src/core/exam-composer.ts";
import { FUNCTION_CATALOG } from "../src/core/function-catalog.ts";
import { flattenPlanQuestions, generateQuestionInstance, orderQuestionInstances } from "../src/core/paper-question-factory.ts";
import { InMemoryStudentExamRepository } from "../src/server/student-exam-repository.ts";

test("a complete 50-question formula paper is automatically graded and remains adjustable per question", async () => {
  const repository: any = new InMemoryStudentExamRepository();
  const plan: any = composeExamPlan({ mode: "exam", selectedFunctions: FUNCTION_CATALOG.map((item) => item.name) }).plan;
  const studentNumber: any = "GRADE-001";
  const exam: any = await repository.publishExam({
    title: "Automatic grading",
    mode: "exam",
    selectedFunctions: plan.coverage.selected,
    plan,
    roster: [{ studentNumber, name: "Grade Student" }],
    createdByLogin: "admin",
  });
  await repository.prepareNextBatch({ examCode: exam.code, batchSize: 1 });
  await repository.verifyIdentity({ examCode: exam.code, studentNumber });
  await repository.admitStudent({ examCode: exam.code, studentNumber });
  await repository.startAttempt({ examCode: exam.code, studentNumber, sessionTokenHash: "grade-session", browserPreflight: { fullscreen: true } });

  const generated: any = orderQuestionInstances(
    flattenPlanQuestions(plan).map((question) => generateQuestionInstance({ examCode: exam.code, studentNumber, question })),
    { examCode: exam.code, studentNumber },
  );
  let version: any = 0;
  for (const question of generated) {
    const answer: any = question.questionMode === "choice" ? question.answerKey.correctOption : question.answerKey.allowedFormula;
    const saved: any = await repository.saveAnswer({ examCode: exam.code, studentNumber, sessionTokenHash: "grade-session", questionKey: question.key, formula: answer, expectedVersion: version });
    version = saved.version;
  }
  await repository.submitAttempt({
    examCode: exam.code,
    studentNumber,
    sessionTokenHash: "grade-session",
    manualConfirmationVerified: true,
  });

  const summary: any = (await repository.listResults(exam.code))[0];
  assert.equal(summary.gradingStatus, "graded");
  assert.equal(summary.score, summary.maximumScore);
  assert.deepEqual(
    { choiceCorrect: summary.choiceCorrect, choiceTotal: summary.choiceTotal, formulaCorrect: summary.formulaCorrect, formulaTotal: summary.formulaTotal },
    { choiceCorrect: 0, choiceTotal: 0, formulaCorrect: 50, formulaTotal: 50 },
  );

  const detail: any = await repository.getResult({ examCode: exam.code, studentNumber });
  assert.equal(detail.questions.length, 50);
  assert.equal(detail.questions.every((question: any) => question.resultStatus === "correct"), true);
  const first: any = detail.questions[0];
  await repository.adjustGrade({ gradeResultId: first.gradeResultId, newScore: 0, reason: "Teacher review", adjustedByLogin: "admin" });
  const adjusted: any = (await repository.listResults(exam.code))[0];
  assert.equal(adjusted.score, summary.score - first.maximumScore);
  assert.equal(adjusted.adjusted, true);
});
