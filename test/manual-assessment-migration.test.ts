import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL("../db/migrations/027_manual_assessment_questions.sql", import.meta.url);

test("migration 027 adds manual question modes without removing Excel structures", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  for (const mode of ["single_choice", "multiple_choice", "fill_blank", "short_answer"]) {
    assert.match(sql, new RegExp(`['\"]${mode}['\"]`));
  }
  assert.match(sql, /assessment_type_key\s*=\s*'manual_questions'/i);
  assert.match(sql, /assessment_type_key\s*<>\s*'manual_questions'/i);
  assert.match(sql, /formula_question_count\s+BETWEEN\s+1\s+AND\s+1500/i);
  assert.match(sql, /VALUES\s*\(27,\s*'027_manual_assessment_questions\.sql'/i);
  assert.equal((sql.match(/\bBEGIN;/g) ?? []).length, 1);
  assert.equal((sql.match(/\bCOMMIT;/g) ?? []).length, 1);
  assert.doesNotMatch(sql, /DROP\s+TABLE|DELETE\s+FROM|TRUNCATE/i);
});
