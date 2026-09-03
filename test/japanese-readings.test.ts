import assert from "node:assert/strict";
import test from "node:test";

import { createJapaneseReadingTokens, JAPANESE_READING_DICTIONARY } from "../src/client/exam/japanese-readings.ts";

test("student reading dictionary covers common complex terms used by generated questions", () => {
  for (const term of ["合計", "平均", "最大値", "最小値", "条件", "検索", "文字列", "四捨五入", "切り上げ", "切り捨て", "確認", "指示", "結果", "対象", "抽出", "一覧", "昇順", "並べ替えて", "重複", "関数", "最初", "行目", "件目"]) {
    assert.equal(typeof JAPANESE_READING_DICTIONARY.get(term), "string");
  }
});

test("a complex term receives a reading only on its first occurrence in one text block", () => {
  const tokens: any = createJapaneseReadingTokens("結果を確認し、結果を表示してください。");

  assert.equal(tokens.filter((token: any) => token.reading && token.text === "結果").length, 1);
  assert.equal(tokens.map((token: any) => token.text).join(""), "結果を確認し、結果を表示してください。");
});
