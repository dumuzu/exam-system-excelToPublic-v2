import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("database migration blocks deleting live attempts and their exam events", async () => {
  const sql: any = await readFile(
    new URL("../db/migrations/016_protect_in_progress_attempts.sql", import.meta.url),
    "utf8",
  );

  assert.match(sql, /BEFORE DELETE ON attempts/);
  assert.match(sql, /OLD\.status = 'in_progress'/);
  assert.match(sql, /BEFORE DELETE ON exams/);
  assert.match(sql, /status = 'in_progress'/);
  assert.match(sql, /ERRCODE = '55000'/);
  assert.match(sql, /EXAM_HAS_IN_PROGRESS_ATTEMPTS/);
});
