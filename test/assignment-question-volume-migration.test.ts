import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("assignment volume migration supports 5, 10 or 15 questions per function without deleting data", async () => {
  const sql: any = await readFile(
    new URL("../db/migrations/015_assignment_question_volume.sql", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(sql, /\b(?:DELETE|TRUNCATE)\b/i);
  assert.match(sql, /formula_question_count BETWEEN 1 AND 1500/);
  assert.match(sql, /formula_group_count BETWEEN 1 AND 250/);
  assert.match(sql, /formula_question_count BETWEEN 5 AND 1500/);
  assert.match(sql, /formula_question_count % 5 = 0/);
  assert.match(sql, /formula_group_count = CEIL\(formula_question_count::NUMERIC \/ 6\)/);
});
