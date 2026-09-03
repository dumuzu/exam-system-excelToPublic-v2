import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("latest stability migration removes legacy exams and enforces reviewed formula-only publications", async () => {
  const sql: any = await readFile(new URL("../db/migrations/011_formula_only_exam_difficulty.sql", import.meta.url), "utf8");
  assert.match(sql, /TRUNCATE TABLE exams, exam_configuration_history, question_blueprints CASCADE/);
  assert.doesNotMatch(sql, /function_choice_count = 10 AND formula_question_count = 30/);
  assert.doesNotMatch(sql, /function_choice_count = 5 AND formula_question_count = 40/);
  assert.match(sql, /function_choice_count = 0 AND formula_question_count = 50/);
  assert.match(sql, /exams_short_code_check/);
  assert.match(sql, /exam_publication_reviews/);
  assert.match(sql, /COALESCE\(settings #>> '\{publicationAudit,status\}', ''\) = 'approved'/);
  assert.match(sql, /review_status/);
  assert.match(sql, /attempts_expiry_scan_idx/);
});
