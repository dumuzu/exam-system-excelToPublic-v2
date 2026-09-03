import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("classroom assignment migration permits untimed five-per-function papers without weakening formal exams", async () => {
  const sql: any = await readFile(
    new URL("../db/migrations/014_classroom_assignment_mode.sql", import.meta.url),
    "utf8",
  );

  assert.match(sql, /ALTER COLUMN duration_minutes DROP NOT NULL/);
  assert.match(sql, /exam_mode = 'exam'[\s\S]*duration_minutes BETWEEN 1 AND 240/);
  assert.match(sql, /exam_mode = 'assignment'[\s\S]*duration_minutes IS NULL/);
  assert.match(sql, /formula_question_count % 5 = 0/);
  assert.match(sql, /formula_question_count BETWEEN 5 AND 500/);
  assert.match(sql, /formula_group_count = CEIL\(formula_question_count::NUMERIC \/ 6\)/);
  assert.match(sql, /settings #>> '\{plan,composerVersion\}'/);
  assert.doesNotMatch(sql, /TRUNCATE|DELETE FROM exams/i);
});
