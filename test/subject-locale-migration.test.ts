import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL("../db/migrations/028_subject_locales_and_bulk_memberships.sql", import.meta.url);

test("migration 028 adds bounded subject localization without changing Excel assessment data", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /ADD COLUMN name_en TEXT/i);
  assert.match(sql, /student_locale[\s\S]*legacy_bilingual[\s\S]*'ja'[\s\S]*'zh'[\s\S]*'en'/i);
  assert.match(sql, /excel-applications[\s\S]*Spreadsheet Practice/i);
  assert.match(sql, /VALUES\s*\(28,\s*'028_subject_locales_and_bulk_memberships\.sql'/i);
  assert.doesNotMatch(sql, /UPDATE\s+exams/i);
});
