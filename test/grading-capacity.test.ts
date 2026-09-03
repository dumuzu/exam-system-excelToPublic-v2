import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";

import { composeExamPlan } from "../src/core/exam-composer.ts";
import { FUNCTION_CATALOG } from "../src/core/function-catalog.ts";
import { gradeSubmission } from "../src/core/formula-grader.ts";
import {
  flattenPlanQuestions,
  generateQuestionInstance,
  orderQuestionInstances,
  validatePreparedPaper,
} from "../src/core/paper-question-factory.ts";

test("capacity certification generates and grades 200 individualized 50-question papers", (context) => {
  const examCode: any = "CAPACITY-GRADING-200";
  const plan: any = composeExamPlan({
    mode: "exam",
    selectedFunctions: FUNCTION_CATALOG.map((definition) => definition.name),
  }).plan;
  const blueprintQuestions: any = flattenPlanQuestions(plan);
  const startedAt: any = performance.now();
  let gradedQuestions: any = 0;

  for (let studentIndex: any = 1; studentIndex <= 200; studentIndex += 1) {
    const studentNumber: any = `LOAD-${String(studentIndex).padStart(3, "0")}`;
    const generated: any = blueprintQuestions.map((question: any) => generateQuestionInstance({ examCode, studentNumber, question }));
    const questions: any = orderQuestionInstances(generated, { examCode, studentNumber });
    assert.equal(validatePreparedPaper(questions, plan).ok, true, studentNumber);
    const answers: any = Object.fromEntries(questions.map((question: any) => [
      question.key,
      question.questionMode === "choice" ? question.answerKey.correctOption : question.answerKey.allowedFormula,
    ]));
    const grading: any = gradeSubmission({ questions, answers });
    assert.equal(grading.totals.awardedScore, grading.totals.maximumScore, studentNumber);
    assert.deepEqual(
      { choice: grading.totals.choiceTotal, formula: grading.totals.formulaTotal },
      { choice: 0, formula: 50 },
      studentNumber,
    );
    gradedQuestions += questions.length;
  }

  const elapsedMs: any = performance.now() - startedAt;
  context.diagnostic(`generated and graded ${gradedQuestions} questions in ${Math.round(elapsedMs)} ms`);
  assert.equal(gradedQuestions, 10_000);
  assert.equal(elapsedMs < 30_000, true, `capacity run exceeded 30 seconds: ${Math.round(elapsedMs)} ms`);
});
