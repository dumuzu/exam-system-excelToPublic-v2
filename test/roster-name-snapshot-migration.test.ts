import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("migration 022 snapshots roster names and records the migration ledger entry", async () => {
  const sql: any = await readFile(
    new URL("../db/migrations/022_exam_roster_name_snapshots.sql", import.meta.url),
    "utf8",
  );

  assert.match(sql, /ALTER TABLE exam_roster\s+ADD COLUMN roster_name TEXT/i);
  assert.match(sql, /UPDATE exam_roster roster\s+SET roster_name\s*=/i);
  assert.match(sql, /ALTER COLUMN roster_name SET NOT NULL/i);
  assert.match(sql, /CHECK \(roster_name IS NOT NULL\s+AND char_length\(btrim\(roster_name\)\) BETWEEN 1 AND 100\) NOT VALID/i);
  assert.match(sql, /VALIDATE CONSTRAINT exam_roster_name_present_check/i);
  assert.match(sql, /VALUES \(22, '022_exam_roster_name_snapshots[.]sql'/);
});
