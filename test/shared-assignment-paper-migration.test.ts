import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("migration 021 stores one immutable shared paper per classroom assignment", async () => {
  const sql: any = await readFile(
    new URL("../db/migrations/021_shared_assignment_papers.sql", import.meta.url),
    "utf8",
  );

  assert.match(sql, /CREATE TABLE assignment_shared_question_instances/);
  assert.match(sql, /exam_id UUID NOT NULL REFERENCES exams\(id\) ON DELETE CASCADE/);
  assert.match(sql, /UNIQUE \(exam_id, question_key\)/);
  assert.match(sql, /UNIQUE \(exam_id, display_order\)/);
  assert.match(sql, /CREATE TRIGGER assignment_shared_questions_guard/);
  assert.match(sql, /<> 'assignment'/);
  assert.match(sql, /SHARED_ASSIGNMENT_PAPER_IMMUTABLE/);
  assert.match(sql, /VALUES \(21, '021_shared_assignment_papers\.sql'/);
});
