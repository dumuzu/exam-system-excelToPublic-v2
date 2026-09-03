import assert from "node:assert/strict";
import test from "node:test";

import { composeExamPlan } from "../src/core/exam-composer.ts";
import { FUNCTION_CATALOG } from "../src/core/function-catalog.ts";

test("teacher preview covers every selected function including formula-capable date functions", () => {
  const result: any = composeExamPlan({
    selectedFunctions: ["LEFT", "IF", "SUMIF", "XLOOKUP", "ROUND", "YEAR", "MONTH", "DAY"],
  });

  assert.equal(result.ok, true);
  assert.equal(result.plan.choiceQuestions.length, 0);
  assert.equal(result.plan.formulaGroups.length, 9);
  assert.deepEqual(result.plan.formulaGroups.map((group: any) => group.questions.length), [6, 6, 6, 6, 6, 6, 6, 6, 2]);
  assert.equal(result.plan.version, 9);
  assert.equal(result.plan.composerVersion, 12);
  assert.deepEqual(result.plan.coverage.uncovered, []);

  const formulaFunctions: any = result.plan.formulaGroups.flatMap((group: any) =>
    group.questions.map((question: any) => question.functionName),
  );

  assert.equal(formulaFunctions.includes("YEAR"), true);
  assert.equal(formulaFunctions.includes("MONTH"), true);
  assert.equal(formulaFunctions.includes("DAY"), true);
});

test("a single selected formula function fills every question without introducing another function", () => {
  const result: any = composeExamPlan({
    selectedFunctions: ["SUM"],
  });

  assert.equal(result.ok, true);
  assert.equal(result.plan.choiceQuestions.every((question: any) => question.functionName === "SUM"), true);
  assert.equal(
    result.plan.formulaGroups.flatMap((group: any) => group.questions).every((question: any) => question.functionName === "SUM"),
    true,
  );
});

test("a date-only selection creates formula questions", () => {
  const result: any = composeExamPlan({ selectedFunctions: ["YEAR"] });

  assert.equal(result.ok, true);
  assert.equal(result.plan.formulaGroups.flatMap((group: any) => group.questions).every((question: any) => question.functionName === "YEAR"), true);
});

test("assignment mode creates five ordered exercises for each selected formula-capable function", () => {
  const result: any = composeExamPlan({
    mode: "assignment",
    selectedFunctions: ["SUM"],
  });

  assert.equal(result.ok, true);
  assert.equal(result.plan.mode, "assignment");
  assert.equal(result.plan.questionCounts.choice, 0);
  assert.equal(result.plan.questionCounts.formula, 5);
  assert.equal(result.plan.formulaGroups.length, 1);
  assert.deepEqual(result.plan.assignmentOptions, {
    formulaQuestionCount: 5,
    choiceQuestionCount: 0,
    formulaQuestionCountMode: "per_function",
    questionsPerFunction: 5,
  });
  assert.equal(result.plan.formulaGroups[0].questions.every((question: any) => question.functionName === "SUM"), true);
});

test("assignment mode creates ten contiguous exercises per selected function when requested", () => {
  const result: any = composeExamPlan({
    mode: "assignment",
    assignmentOptions: { questionsPerFunction: 10 },
    selectedFunctions: ["SUM", "AVERAGE"],
  });

  assert.equal(result.ok, true);
  assert.equal(result.plan.questionCounts.formula, 20);
  assert.equal(result.plan.assignmentOptions.questionsPerFunction, 10);
  assert.deepEqual(
    result.plan.formulaGroups.flatMap((group: any) => group.questions).map((question: any) => question.functionName),
    [...Array(10).fill("SUM"), ...Array(10).fill("AVERAGE")],
  );
});

test("assignment mode creates five contiguous exercises for every selected function", () => {
  const selectedFunctions: any = FUNCTION_CATALOG.slice(0, 30).map((definition) => definition.name);
  const result: any = composeExamPlan({
    mode: "assignment",
    assignmentOptions: { formulaQuestionCountMode: "auto", choiceQuestionCount: 0 } as any,
    selectedFunctions,
  });

  assert.equal(result.ok, true);
  assert.equal(result.plan.questionCounts.formula, 150);
  assert.equal(result.plan.coverage.uncovered.length, 0);
  assert.equal(result.warnings.length, 0);
  assert.equal(result.plan.coverage.allocations.every((allocation: any) => allocation.count === 5), true);
  const orderedFunctions: any = result.plan.formulaGroups.flatMap((group: any) => group.questions).map((question: any) => question.functionName);
  assert.deepEqual(orderedFunctions, selectedFunctions.flatMap((name: any) => Array(5).fill(name)));
});

test("legacy lookup functions are rejected because XLOOKUP is the only supported lookup function", () => {
  const result: any = composeExamPlan({
    selectedFunctions: ["SUM", "IF", "SUMIF", "XLOOKUP", "ROUND", "VLOOKUP"],
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.errors[0], {
    code: "UNKNOWN_FUNCTION",
    message: "包含不在首版函数白名单中的函数。",
    details: { functions: ["VLOOKUP"] },
  });
});

test("the full supported catalog fits the fixed 50-question formula-only exam structure", () => {
  const result: any = composeExamPlan({
    selectedFunctions: FUNCTION_CATALOG.map((functionDefinition) => functionDefinition.name),
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.plan.coverage.uncovered, []);
  assert.equal(result.plan.choiceQuestions.length, 0);
  assert.equal(result.plan.formulaGroups.flatMap((group: any) => group.questions).length, 50);
});

test("normal difficulty allocates exactly ten double-function questions", () => {
  const result: any = composeExamPlan({ mode: "exam", difficulty: "normal", selectedFunctions: ["SUM", "ROUND", "MAX", "XLOOKUP", "UPPER", "IF", "AND"] });
  assert.equal(result.ok, true);
  const formulaQuestions: any = result.plan.formulaGroups.flatMap((group: any) => group.questions);
  assert.equal(formulaQuestions.filter((question: any) => question.combinationLevel === 2).length, 10);
  assert.equal(formulaQuestions.filter((question: any) => question.combinationLevel === 3).length, 0);
  assert.equal(result.plan.compositePolicy.doubleActualCount, 10);
  assert.equal(result.plan.compositePolicy.tripleActualCount, 0);
  assert.equal(formulaQuestions.every((question: any) => question.requiredFunctions.every((name: any) => result.plan.coverage.selected.includes(name))), true);
  assert.equal(formulaQuestions.every((question: any) => (question.companionCandidates ?? []).every((name: any) => result.plan.coverage.selected.includes(name))), true);
});

test("easy difficulty creates ten fixed choices, twenty-five single-function formulas, and five double-function formulas", () => {
  const result: any = composeExamPlan({
    mode: "exam",
    difficulty: "easy",
    selectedFunctions: FUNCTION_CATALOG.map((item) => item.name),
  });
  assert.equal(result.ok, true);
  const formulaQuestions: any = result.plan.formulaGroups.flatMap((group: any) => group.questions);
  assert.equal(result.plan.choiceQuestions.length, 10);
  assert.equal(formulaQuestions.length, 30);
  assert.equal(formulaQuestions.filter((question: any) => question.combinationLevel === 1).length, 25);
  assert.equal(formulaQuestions.filter((question: any) => question.combinationLevel === 2).length, 5);
  assert.equal(formulaQuestions.filter((question: any) => question.combinationLevel === 3).length, 0);
});

test("hard difficulty allocates exactly twenty double-function questions", () => {
  const result: any = composeExamPlan({ mode: "exam", difficulty: "hard", selectedFunctions: FUNCTION_CATALOG.map((item) => item.name) });
  assert.equal(result.plan.compositePolicy.doubleActualCount, 20);
  assert.equal(result.plan.compositePolicy.tripleActualCount, 0);
});

test("hell difficulty allocates twenty-five double and ten triple-function questions", () => {
  const result: any = composeExamPlan({ mode: "exam", difficulty: "hell", selectedFunctions: FUNCTION_CATALOG.map((item) => item.name) });
  assert.equal(result.plan.compositePolicy.doubleActualCount, 25);
  assert.equal(result.plan.compositePolicy.tripleActualCount, 10);
  assert.equal(result.plan.difficulty, "hell");
});

test("a single selected function never introduces an unselected companion", () => {
  const result: any = composeExamPlan({ mode: "exam", selectedFunctions: ["SUM"] });
  const formulaQuestions: any = result.plan.formulaGroups.flatMap((group: any) => group.questions);
  assert.equal(formulaQuestions.every((question: any) => question.companionFunction === null), true);
  assert.equal(result.plan.compositePolicy.actualCount, 0);
  assert.equal(result.warnings.some((warning: any) => warning.code === "COMBINATION_TARGET_SHORTFALL"), true);
});
