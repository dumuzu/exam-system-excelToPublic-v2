import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { FUNCTION_CATALOG } from "../src/core/function-catalog.ts";

test("migration 026 publishes every application-supported function and advances the ledger", async () => {
  const sql = await readFile(new URL("../db/migrations/026_complete_function_catalog.sql", import.meta.url), "utf8");

  for (const definition of FUNCTION_CATALOG) {
    assert.match(sql, new RegExp(`\\('${definition.name}'\\s*,\\s*'${definition.category}'`));
  }
  assert.match(sql, /ON CONFLICT \(function_name\) DO UPDATE SET/i);
  assert.match(sql, /VALUES \(26, '026_complete_function_catalog[.]sql'/i);
  assert.match(sql, /BEGIN;/i);
  assert.match(sql, /COMMIT;/i);
  assert.doesNotMatch(sql, /TRUNCATE|DELETE FROM/i);
});
