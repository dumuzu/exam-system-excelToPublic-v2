import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("revoked browser sessions do not block a teacher-authorized second attempt", async () => {
  const sql: any = await readFile(new URL("../db/migrations/012_active_session_token_lifecycle.sql", import.meta.url), "utf8");

  assert.match(sql, /DROP CONSTRAINT IF EXISTS active_sessions_session_token_hash_key/);
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS active_sessions_active_token_hash_idx/);
  assert.match(sql, /WHERE status = 'active'/);
  assert.doesNotMatch(sql, /TRUNCATE|DELETE FROM active_sessions/i);
});
