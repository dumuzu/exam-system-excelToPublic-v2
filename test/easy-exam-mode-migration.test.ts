import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("easy exam migration permits the 10-choice and 40-formula structure without deleting data", async () => {
  const sql: any = await readFile(
    new URL("../db/migrations/017_easy_exam_mode.sql", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(sql, /\b(?:DELETE|TRUNCATE)\b/i);
  assert.match(sql, /settings #>> '\{plan,difficulty\}'/);
  assert.match(sql, /function_choice_count = 10/);
  assert.match(sql, /formula_question_count = 40/);
  assert.match(sql, /formula_group_count = 7/);
  assert.match(sql, /function_choice_count = 0/);
  assert.match(sql, /formula_question_count = 50/);
});
