import assert from "node:assert/strict";
import test from "node:test";

import {
  createFunctionHint,
  createStandardQuestionPrompt,
  validateQuestionPromptRowReferences,
  worksheetDataRowLabel,
} from "../src/core/question-language.ts";

test("standard question language explains a filtered list with an explicit column and condition", () => {
  assert.equal(
    createStandardQuestionPrompt("Route が Priority の Shipment ID 一覧を抽出してください。"),
    "次の表を確認してください。「Route」列が「Priority」の行だけを対象にし、「Shipment ID」列の値を一覧で取り出してください。",
  );
});

test("standard question language removes handwritten readings and uses a consistent instruction frame", () => {
  const prompt: any = createStandardQuestionPrompt("Value 列の合計（ごうけい）を求めてください。");

  assert.equal(prompt, "次の表を確認し、次の指示に従って結果を求めてください。「Value」列の合計を求めてください。");
  assert.doesNotMatch(prompt, /（ごうけい）/);
});

test("function hints name the required functions without revealing formula structure", () => {
  const hint: any = createFunctionHint(["FILTER", "SORT"]);

  assert.equal(hint, "関数のヒント：FILTER + SORT / Function hint: FILTER + SORT");
  assert.doesNotMatch(hint, /=|\(|\)/);
});

test("data row ordinals are translated to visible worksheet row numbers", () => {
  assert.equal(worksheetDataRowLabel(1), "表の2行目（最初のデータ行）");
  assert.equal(worksheetDataRowLabel(3), "表の4行目（3件目のデータ行）");
});

test("standard question language translates data ordinals before students see them", () => {
  assert.equal(
    createStandardQuestionPrompt("1行目の Account から4文字を取り出してください。"),
    "次の表を確認し、次の指示に従って結果を求めてください。表の2行目（最初のデータ行）の Account から4文字を取り出してください。",
  );
});

test("question row labels must match a row referenced by the standard formula", () => {
  assert.equal(validateQuestionPromptRowReferences({
    promptJa: "表の2行目（最初のデータ行）の Account から4文字を取り出してください。",
    formula: "=MID(E2,7,4)",
  }), true);
  assert.throws(
    () => validateQuestionPromptRowReferences({
      promptJa: "表の3行目（2件目のデータ行）の Account から4文字を取り出してください。",
      formula: "=MID(E2,7,4)",
    }),
    /QUESTION_PROMPT_ROW_FORMULA_MISMATCH/,
  );
});
