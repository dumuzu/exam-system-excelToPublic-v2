import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("migration 020 permits new 40-question Easy papers while retaining legacy Easy records", async () => {
  const sql: any = await readFile(
    new URL("../db/migrations/020_easy_40_question_exam.sql", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(sql, /\b(?:DELETE|TRUNCATE|UPDATE\s+exams)\b/i);
  assert.match(sql, /composerVersion/);
  assert.match(sql, /function_choice_count = 10/);
  assert.match(sql, /formula_question_count = 30/);
  assert.match(sql, /formula_group_count = 5/);
  assert.match(sql, /formula_question_count = 40/);
  assert.match(sql, /formula_group_count = 7/);
  assert.match(sql, /INSERT INTO schema_migrations/);
  assert.match(sql, /020_easy_40_question_exam[.]sql/);
});
