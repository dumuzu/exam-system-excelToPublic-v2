import assert from "node:assert/strict";
import test from "node:test";

import {
  getExamModeDefinitions,
  getStudentExperiencePolicy,
  resolveExamModeStructure,
} from "../src/core/exam-mode-config.ts";

test("exam mode configuration exposes fixed exam settings and selectable assignment questions per function", () => {
  const definitions: any = getExamModeDefinitions();
  assert.deepEqual(definitions.map((definition: any) => definition.key), ["exam", "assignment"]);

  assert.deepEqual(resolveExamModeStructure({ mode: "exam" }), {
    ok: true,
    value: { mode: "exam", choiceQuestionCount: 0, formulaQuestionCount: 50 },
  });
  assert.equal(Object.hasOwn(getExamModeDefinitions()[0]!, "choiceQuestionCount"), false);
  assert.deepEqual(resolveExamModeStructure({
    mode: "assignment",
    selectedFormulaFunctionCount: 7,
    assignmentOptions: { questionsPerFunction: 10 },
  }), {
    ok: true,
    value: { mode: "assignment", choiceQuestionCount: 0, formulaQuestionCount: 70, formulaQuestionCountMode: "per_function", questionsPerFunction: 10 },
  });
  assert.deepEqual(definitions[1].questionsPerFunctionOptions, [5, 10, 15]);
  assert.equal(definitions[1].defaultQuestionsPerFunction, 5);
});

test("easy exam mode contains ten fixed choices, twenty-five single-function questions, and five double-function questions", () => {
  const definitions: any = getExamModeDefinitions();
  const easy: any = definitions[0].difficulties.find((difficulty: any) => difficulty.key === "easy");

  assert.deepEqual(easy, {
    key: "easy",
    choiceQuestionCount: 10,
    formulaQuestionCount: 30,
    doubleQuestionCount: 5,
    tripleQuestionCount: 0,
  });
  assert.deepEqual(resolveExamModeStructure({ mode: "exam", difficulty: "easy" }), {
    ok: true,
    value: { mode: "exam", choiceQuestionCount: 10, formulaQuestionCount: 30 },
  });
});

test("assignment mode ignores legacy manual and choice counts", () => {
  const result: any = resolveExamModeStructure({
    mode: "assignment",
    selectedFormulaFunctionCount: 2,
    assignmentOptions: { formulaQuestionCount: 4, choiceQuestionCount: 5 } as any,
  });

  assert.deepEqual(result, {
    ok: true,
    value: { mode: "assignment", choiceQuestionCount: 0, formulaQuestionCount: 10, formulaQuestionCountMode: "per_function", questionsPerFunction: 5 },
  });
});

test("automatic assignment count follows the selected formula-capable functions", () => {
  assert.deepEqual(resolveExamModeStructure({
    mode: "assignment",
    selectedFormulaFunctionCount: 30,
    assignmentOptions: { formulaQuestionCountMode: "auto", formulaQuestionCount: 3, choiceQuestionCount: 0 } as any,
  }), {
    ok: true,
    value: { mode: "assignment", choiceQuestionCount: 0, formulaQuestionCount: 150, formulaQuestionCountMode: "per_function", questionsPerFunction: 5 },
  });
});

test("mode definitions are safe for UI callers to read without changing later resolutions", () => {
  const definitions: any = getExamModeDefinitions();
  definitions[1].defaultQuestionsPerFunction = 1;
  definitions[1].questionsPerFunctionOptions[0] = 1;

  assert.equal(getExamModeDefinitions()[1]!.defaultQuestionsPerFunction, 5);
  assert.deepEqual(getExamModeDefinitions()[1]!.questionsPerFunctionOptions, [5, 10, 15]);
  assert.equal(Object.hasOwn(getExamModeDefinitions()[1]!, "choiceQuestionCounts"), false);
  assert.deepEqual(resolveExamModeStructure({ mode: "unknown" }), {
    ok: false,
    errors: [{ code: "UNKNOWN_MODE", message: "出卷模式无效。", details: { mode: "unknown" } }],
  });
});

test("assignment mode rejects unsupported questions-per-function values", () => {
  assert.deepEqual(resolveExamModeStructure({
    mode: "assignment",
    selectedFormulaFunctionCount: 2,
    assignmentOptions: { questionsPerFunction: 7 },
  }), {
    ok: false,
    errors: [{
      code: "INVALID_ASSIGNMENT_QUESTION_COUNT",
      message: "课题模式中每个函数的题量只能选择 5、10 或 15。",
      details: { questionsPerFunction: 7 },
    }],
  });
});

test("student experience policies keep formal exams strict and classroom assignments lightweight", () => {
  assert.deepEqual(getStudentExperiencePolicy("exam"), {
    mode: "exam", requiresAdmission: true, requiresFullscreen: true, hasTimeLimit: true,
    proctoringEnabled: true, autosaveEnabled: true, sharedPaper: false,
    randomizeQuestionOrder: true, revealScoreAfterSubmission: false, maximumAttempts: null,
  });
  assert.deepEqual(getStudentExperiencePolicy("assignment"), {
    mode: "assignment", requiresAdmission: false, requiresFullscreen: false, hasTimeLimit: false,
    proctoringEnabled: false, autosaveEnabled: false, sharedPaper: true,
    randomizeQuestionOrder: false, revealScoreAfterSubmission: true, maximumAttempts: 2,
  });
});
