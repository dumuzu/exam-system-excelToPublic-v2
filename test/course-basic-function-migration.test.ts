import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("course basic function migration publishes VALUE, MOD and TEXT safely", async () => {
  const sql: any = await readFile(new URL("../db/migrations/013_course_basic_function_catalog.sql", import.meta.url), "utf8");

  for (const functionName of ["VALUE", "MOD", "TEXT"]) {
    assert.match(sql, new RegExp(`\\('${functionName}'`));
  }
  assert.match(sql, /ON CONFLICT \(function_name\) DO UPDATE SET/);
  assert.match(sql, /is_active = TRUE/);
  assert.match(sql, /BEGIN;/);
  assert.match(sql, /COMMIT;/);
  assert.doesNotMatch(sql, /TRUNCATE|DELETE FROM/i);
});
