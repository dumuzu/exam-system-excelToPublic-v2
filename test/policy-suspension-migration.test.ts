import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("policy suspension migration preserves answers and records resumable stop periods", async () => {
  const sql: any = await readFile(
    new URL("../db/migrations/018_policy_suspension_and_teacher_collection.sql", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(sql, /^\s*(?:DELETE\s+FROM|TRUNCATE\b)/im);
  assert.match(sql, /'policy_suspended'/);
  assert.match(sql, /'teacher_submitted'/);
  assert.match(sql, /submission_type IN \('manual', 'timer', 'teacher'/);
  assert.match(sql, /CREATE TABLE attempt_policy_suspensions/);
  assert.match(sql, /CREATE TABLE exam_termination_runs/);
  assert.match(sql, /remaining_seconds INTEGER NOT NULL/);
  assert.match(sql, /WHERE status = 'suspended'/);
  assert.match(sql, /attempts_one_open_per_exam_student_idx/);
  assert.match(sql, /active_sessions_active_expiry_idx/);
  assert.match(sql, /active_sessions_attempt_identity_fkey/);
  assert.match(sql, /proctor_events_event_attempt_key/);
  assert.match(sql, /DEFERRABLE INITIALLY DEFERRED/);
  assert.match(sql, /status IN \('suspended', 'resumed', 'collected'\)/);
  assert.match(sql, /UPDATE active_sessions[\s\S]*status = 'expired'/);
  assert.match(sql, /OLD\.status IN \('in_progress', 'policy_suspended'\)/);
  assert.match(sql, /status IN \('in_progress', 'policy_suspended'\)/);
});
