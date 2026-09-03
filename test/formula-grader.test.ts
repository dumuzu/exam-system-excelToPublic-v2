import assert from "node:assert/strict";
import test from "node:test";

import { gradeFormulaAnswer, gradeQuestionAnswer, gradeSubmission } from "../src/core/formula-grader.ts";

const input: any = {
  table: { columns: ["Product", "Sales"], rows: [{ Product: "A", Sales: 10 }, { Product: "B", Sales: 20 }] },
  answerKey: { expectedValue: 30 },
  scoringRule: { maximumScore: 2.5, coreFunctionMissingScore: 1.5, numericEpsilon: 1e-6, requiredFunction: "SUM" },
};

test("formula grader awards full score for a correct required function", () => {
  assert.deepEqual(gradeFormulaAnswer({ ...input, formula: "=SUM(B2:B3)" }), {
    awardedScore: 2.5, maximumScore: 2.5, status: "correct", calculatedValue: 30,
  });
});

test("formula grader awards partial credit for a correct result without SUM", () => {
  assert.equal(gradeFormulaAnswer({ ...input, formula: "=B2+B3" }).awardedScore, 1.5);
});

test("formula grader rejects unsupported or incorrect expressions without executing code", () => {
  assert.equal(gradeFormulaAnswer({ ...input, formula: "=process.exit()" }).status, "incorrect");
  assert.equal(gradeFormulaAnswer({ ...input, formula: "=SUM(A2:A3)" }).status, "incorrect");
});

test("formula grader compares text and booleans and finds required functions in the AST", () => {
  const table: any = { columns: ["Code", "Value"], rows: [{ Code: "a-1", Value: 20 }] };
  const textGrade: any = gradeFormulaAnswer({
    formula: "=UPPER(A2)", table,
    answerKey: { expectedValue: "A-1" },
    scoringRule: { maximumScore: 3, coreFunctionMissingScore: 1.5, numericEpsilon: 1e-6, requiredFunctions: ["UPPER"] },
  });
  assert.equal(textGrade.status, "correct");
  const booleanGrade: any = gradeFormulaAnswer({
    formula: "=B2>=20", table,
    answerKey: { expectedValue: true },
    scoringRule: { maximumScore: 3, coreFunctionMissingScore: 1.5, numericEpsilon: 1e-6, requiredFunctions: ["AND"] },
  });
  assert.equal(booleanGrade.status, "partial_core_function_missing");
  assert.equal(gradeFormulaAnswer({
    formula: "=\"SUM\"", table,
    answerKey: { expectedValue: "SUM" },
    scoringRule: { maximumScore: 3, coreFunctionMissingScore: 1.5, numericEpsilon: 1e-6, requiredFunctions: ["SUM"] },
  }).status, "partial_core_function_missing");
});

test("formula grader requires every configured function in a combination", () => {
  const grade: any = gradeFormulaAnswer({
    ...input,
    formula: "=SUM(B2:B3)",
    scoringRule: { ...input.scoringRule, maximumScore: 4, coreFunctionMissingScore: 2, requiredFunctions: ["SUM", "ROUND"] },
  });
  assert.deepEqual({ status: grade.status, awardedScore: grade.awardedScore }, { status: "partial_core_function_missing", awardedScore: 2 });
});

test("question grader scores choices without exposing answer keys to the student", () => {
  const question: any = { key: "choice-1", questionMode: "choice", answerKey: { correctOption: "XLOOKUP" }, scoringRule: { maximumScore: 1, version: "choice-v1" } };
  assert.equal(gradeQuestionAnswer({ question, answer: "XLOOKUP" }).status, "correct");
  assert.equal(gradeQuestionAnswer({ question, answer: "SUM" }).awardedScore, 0);
});

test("submission grader grades every question and aggregates mode totals", () => {
  const questions: any = [
    { key: "choice-1", questionMode: "choice", answerKey: { correctOption: "SUM" }, scoringRule: { maximumScore: 1, version: "choice-v1" } },
    { key: "formula-1", questionMode: "formula", studentPayload: input.table ? { table: input.table } : {}, answerKey: input.answerKey, scoringRule: input.scoringRule },
    { key: "formula-2", questionMode: "formula", studentPayload: { table: input.table }, answerKey: input.answerKey, scoringRule: input.scoringRule },
  ];
  const grade: any = gradeSubmission({ questions, answers: { "choice-1": "SUM", "formula-1": "=SUM(B2:B3)", "formula-2": "=B2+B3" } });
  assert.equal(grade.results.length, 3);
  assert.deepEqual(grade.totals, { awardedScore: 5, maximumScore: 6, choiceCorrect: 1, choiceTotal: 1, formulaCorrect: 1, formulaTotal: 2 });
  assert.equal(grade.status, "graded");
});

test("policy submission creates a zero result for every question", () => {
  const questions: any = [
    { key: "choice-1", questionMode: "choice", answerKey: { correctOption: "SUM" }, scoringRule: { maximumScore: 1 } },
    { key: "formula-1", questionMode: "formula", studentPayload: { table: input.table }, answerKey: input.answerKey, scoringRule: input.scoringRule },
  ];
  const grade: any = gradeSubmission({ questions, answers: { "choice-1": "SUM", "formula-1": "=SUM(B2:B3)" }, policyViolation: true });
  assert.deepEqual(grade.results.map((result: any) => result.awardedScore), [0, 0]);
  assert.equal(grade.totals.maximumScore, 3.5);
});

test("formula grader can compare fixed decimal answers without binary floating drift", () => {
  const grade: any = gradeFormulaAnswer({
    formula: "=0.1+0.2",
    table: { columns: ["Value"], rows: [] },
    answerKey: { expectedValue: "0.30" },
    scoringRule: { maximumScore: 3, coreFunctionMissingScore: 1.5, numericMode: "decimal", requiredFunctions: [] },
  });
  assert.equal(grade.status, "correct");
});

test("decimal grading still applies the configured epsilon to repeating results", () => {
  const grade: any = gradeFormulaAnswer({
    formula: "=AVERAGE(A2:A4)",
    table: { columns: ["Value"], rows: [{ Value: 13 }, { Value: 14 }, { Value: 14 }] },
    answerKey: { expectedValue: 13.666666666666666 },
    scoringRule: {
      maximumScore: 3,
      coreFunctionMissingScore: 1.5,
      numericMode: "decimal",
      numericEpsilon: 1e-6,
      requiredFunctions: ["AVERAGE"],
    },
  });
  assert.equal(grade.status, "correct");
});

test("formula grader tolerates case and half-width or full-width text differences", () => {
  const table: any = { columns: ["Group"], rows: [{ Group: "East" }] };
  const grade: any = gradeFormulaAnswer({
    formula: "＝ｉｆ（Ａ２＝＂Ｅａｓｔ＂，＂ＯＫ＂，＂ＮＯ＂）",
    table,
    answerKey: { expectedValue: " ｏｋ " },
    scoringRule: { maximumScore: 3, coreFunctionMissingScore: 1.5, requiredFunctions: ["IF"] },
  });
  assert.equal(grade.status, "correct");
});

test("formula grader can explicitly require case while still normalising character width", () => {
  const grade: any = gradeFormulaAnswer({
    formula: "＝＂ＡＢＣ＂",
    table: { columns: ["Value"], rows: [] },
    answerKey: { expectedValue: "abc" },
    scoringRule: { maximumScore: 1, requiredFunctions: [], caseSensitiveText: true },
  });
  assert.equal(grade.status, "incorrect");
});
