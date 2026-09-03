import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("migration 019 adds an append-only migration ledger and durable collection failures", async () => {
  const sql: any = await readFile(new URL("../db/migrations/019_migration_ledger_and_termination_failures.sql", import.meta.url), "utf8");

  assert.match(sql, /CREATE TABLE schema_migrations/);
  assert.match(sql, /CREATE TRIGGER schema_migrations_append_only/);
  assert.match(sql, /MIGRATION_LEDGER_APPEND_ONLY/);
  assert.match(sql, /INSERT INTO schema_migrations/);
  for (let version: any = 1; version <= 19; version += 1) {
    assert.match(sql, new RegExp(`\\(${version},\\s*'${String(version).padStart(3, "0")}_`));
  }

  assert.match(sql, /CREATE TABLE exam_termination_failures/);
  assert.match(sql, /UNIQUE \(termination_run_id, attempt_id\)/);
  assert.match(sql, /exam_termination_failures_unresolved_idx/);
  assert.match(sql, /occurrence_count INTEGER NOT NULL DEFAULT 1/);
  assert.match(sql, /resolved_at TIMESTAMPTZ/);
  assert.match(sql, /last_retried_by_teacher_id/);
});
