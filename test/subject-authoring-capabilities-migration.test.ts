import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("migration 029 backfills reusable subject authoring capabilities without rewriting historical assessments", async () => {
  const sql = await readFile(new URL("../db/migrations/029_subject_authoring_capabilities.sql", import.meta.url), "utf8");
  assert.match(sql, /CREATE TABLE subject_authoring_capabilities/i);
  assert.match(sql, /PRIMARY KEY \(subject_id, assessment_type_key\)/i);
  assert.match(sql, /SELECT id, assessment_type_key, 0\s+FROM subjects/i);
  assert.doesNotMatch(sql, /UPDATE\s+(exams|exam_configuration_history)/i);
  assert.match(sql, /VALUES \(29, '029_subject_authoring_capabilities\.sql'/i);
  assert.equal((sql.match(/\bBEGIN;/g) ?? []).length, 1);
  assert.equal((sql.match(/\bCOMMIT;/g) ?? []).length, 1);
});
