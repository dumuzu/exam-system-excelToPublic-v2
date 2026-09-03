import assert from "node:assert/strict";
import test from "node:test";
import { FUNCTION_CATALOG } from "../src/core/function-catalog.ts";
import { flattenPlanQuestions, generateQuestionInstance, orderQuestionInstances, validatePreparedPaper } from "../src/core/paper-question-factory.ts";
import { composeExamPlan } from "../src/core/exam-composer.ts";

test("question factory structurally covers every selectable function", () => {
  for (const definition of FUNCTION_CATALOG) {
    const mode: any = definition.modes.includes("formula") ? "formula" : "choice";
    const instance: any = generateQuestionInstance({ examCode: "FACTORY", studentNumber: "S1", question: { id: `q-${definition.name}`, functionName: definition.name, mode } });
    assert.equal(instance.functionName, definition.name);
    assert.equal(instance.questionMode, mode);
    assert.equal("answerKey" in instance.studentPayload, false);
    assert.match(instance.studentPayload.promptEn, /\S/);
  }
});

test("course-derived VALUE, MOD and TEXT functions are selectable and generate gradable questions", () => {
  for (const functionName of ["VALUE", "MOD", "TEXT"]) {
    assert.equal(FUNCTION_CATALOG.some((definition) => definition.name === functionName && definition.modes.includes("formula")), true, functionName);
    const instance: any = generateQuestionInstance({
      examCode: "COURSE-BASICS",
      studentNumber: "S1",
      question: { id: `q-${functionName}`, functionName, mode: "formula" },
    });
    assert.equal(instance.functionName, functionName);
    assert.match(instance.studentPayload.tipJa, new RegExp(`\\b${functionName}\\b`));
  }
});

test("factory creates, mixes and validates a deterministic 50-question normal exam paper", () => {
  const plan: any = composeExamPlan({ mode: "exam", selectedFunctions: FUNCTION_CATALOG.map((item) => item.name) }).plan;
  const unordered: any = flattenPlanQuestions(plan).map((question) => generateQuestionInstance({ examCode: "EXAM", studentNumber: "S1", question }));
  const questions: any = orderQuestionInstances(unordered, { examCode: "EXAM", studentNumber: "S1" });
  assert.equal(questions.length, 50);
  assert.deepEqual(validatePreparedPaper(questions, plan), { ok: true, errors: [], expectedQuestionCount: 50 });
  assert.deepEqual(orderQuestionInstances(unordered, { examCode: "EXAM", studentNumber: "S1" }), questions);
  assert.notDeepEqual(orderQuestionInstances(unordered, { examCode: "EXAM", studentNumber: "S2" }).map((item: any) => item.key), questions.map((item: any) => item.key));
  assert.equal(questions.filter((question: any) => question.questionMode === "choice").length, 0);
  assert.equal(questions.filter((question: any) => question.studentPayload.difficulty === "advanced").length, 10);
  assert.equal(questions.filter((question: any) => question.questionMode === "choice").every((question: any) => question.studentPayload.tipJa === undefined), true);
  assert.equal(questions.filter((question: any) => question.questionMode === "formula" && question.scoringRule.requiredFunctions.length === 3).length, 0);
  assert.equal(questions.filter((question: any) => question.questionMode === "formula").every((question: any) =>
    question.scoringRule.requiredFunctions.every((name: any) => question.studentPayload.tipJa.includes(name))
      && !/[=(]/.test(question.studentPayload.tipJa)
  ), true);
  assert.equal(questions.filter((question: any) => question.questionMode === "formula").every((question: any) =>
    question.studentPayload.promptJa.startsWith("次の表を確認")
  ), true);
  assert.equal(questions.filter((question: any) => question.questionMode === "formula" && question.scoringRule.requiredFunctions.length === 3).every((question: any) => question.studentPayload.functionCount === 3), true);
});

test("dynamic list questions use an explicit student-friendly condition template", () => {
  const instance: any = generateQuestionInstance({
    examCode: "LANGUAGE",
    studentNumber: "S1",
    question: { id: "filter", functionName: "FILTER", mode: "formula" },
  });

  assert.match(instance.studentPayload.promptJa, /「.+」列が「.+」の行だけを対象にし、「.+」列の値を一覧で取り出してください。/);
  assert.equal(instance.studentPayload.tipJa, "関数のヒント：FILTER / Function hint: FILTER");
});

test("single-row questions use the worksheet row number visible to students", () => {
  const instance: any = generateQuestionInstance({
    examCode: "VISIBLE-ROW",
    studentNumber: "S1",
    question: { id: "mid", functionName: "MID", mode: "formula" },
  });

  assert.match(instance.answerKey.allowedFormula, /\$?[A-Z]+\$?2\b/);
  assert.match(instance.studentPayload.promptJa, /表の2行目（最初のデータ行）/);
  assert.doesNotMatch(instance.studentPayload.promptJa, /(?<!表の)1行目/);
  assert.match(instance.studentPayload.promptEn, /worksheet row 2 \(the first data row\)/i);
});

test("easy papers provide bilingual prompts for all choice and formula questions", () => {
  const plan: any = composeExamPlan({
    difficulty: "easy",
    selectedFunctions: FUNCTION_CATALOG.map((item) => item.name),
  }).plan;
  const questions: any = flattenPlanQuestions(plan).map((question) =>
    generateQuestionInstance({ examCode: "EASY-BILINGUAL", studentNumber: "S1", question })
  );

  assert.equal(questions.length, 40);
  assert.equal(questions.every((question: any) => question.studentPayload.promptJa?.length > 0), true);
  assert.equal(questions.every((question: any) => question.studentPayload.promptEn?.length > 0), true);
});

test("reviewed bilingual templates do not fall back to Japanese-only instructions", () => {
  const selectedFunctions: any = FUNCTION_CATALOG.map((item) => item.name);
  for (const difficulty of ["easy", "normal", "hard", "hell"]) {
    const plan: any = composeExamPlan({ difficulty, selectedFunctions }).plan;
    const sourceQuestions: any = flattenPlanQuestions(plan);
    for (let studentIndex: any = 1; studentIndex <= 20; studentIndex += 1) {
      for (const question of sourceQuestions) {
        const instance: any = generateQuestionInstance({
          examCode: `BILINGUAL-${difficulty}`,
          studentNumber: `S${studentIndex}`,
          question,
        });
        assert.doesNotMatch(instance.studentPayload.promptEn, /described in the Japanese instruction/i);
      }
    }
  }
});

test("hell difficulty materializes ten three-function questions", () => {
  const plan: any = composeExamPlan({ difficulty: "hell", selectedFunctions: FUNCTION_CATALOG.map((item) => item.name) }).plan;
  const questions: any = flattenPlanQuestions(plan).map((question) =>
    generateQuestionInstance({ examCode: "HELL", studentNumber: "S1", question })
  );
  const triples: any = questions.filter((question: any) => question.scoringRule.requiredFunctions.length === 3);
  assert.equal(triples.length, 10);
  assert.equal(triples.every((question: any) => question.studentPayload.functionCount === 3), true);
});

test("factory creates a valid shared-order assignment with five exercises per selected function", () => {
  const selectedFunctions: any = FUNCTION_CATALOG
    .filter((definition) => definition.modes.includes("formula"))
    .map((definition) => definition.name);
  const plan: any = composeExamPlan({
    mode: "assignment",
    assignmentOptions: { formulaQuestionCountMode: "auto", choiceQuestionCount: 0 } as any,
    selectedFunctions,
  }).plan;
  const questions: any = flattenPlanQuestions(plan).map((question) =>
    generateQuestionInstance({ examCode: "ASSIGNMENT", studentNumber: "S1", question })
  );

  assert.equal(questions.length, selectedFunctions.length * 5);
  assert.deepEqual(validatePreparedPaper(questions, plan), {
    ok: true,
    errors: [],
    expectedQuestionCount: selectedFunctions.length * 5,
  });
  assert.deepEqual(new Set(questions.map((question: any) => question.functionName)), new Set(selectedFunctions));
  assert.deepEqual(
    questions.map((question: any) => question.functionName),
    selectedFunctions.flatMap((name: any) => Array(5).fill(name)),
  );
});

test("student seed changes compatible function pairing without using unselected functions", () => {
  const plan: any = composeExamPlan({ mode: "exam", selectedFunctions: ["MAX", "MIN", "XLOOKUP"] }).plan;
  const source: any = flattenPlanQuestions(plan).find((question) => question.functionName === "XLOOKUP" && question.companionCandidates?.length === 2);
  const instances: any = Array.from({ length: 20 }, (_, index) => generateQuestionInstance({ examCode: "PAIRING", studentNumber: `S${index + 1}`, question: source }));
  const companions: any = new Set(instances.map((instance: any) => instance.scoringRule.requiredFunctions[1]));
  assert.deepEqual(companions, new Set(["MAX", "MIN"]));
  assert.equal(instances.flatMap((instance: any) => instance.scoringRule.requiredFunctions).every((name: any) => plan.coverage.selected.includes(name)), true);
});
