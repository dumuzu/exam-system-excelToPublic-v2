import assert from "node:assert/strict";
import test from "node:test";

import { chunkRowsForPostgres } from "../src/server/postgres-batch-policy.ts";

test("large prepared-paper inserts stay below the PostgreSQL parameter limit", () => {
  const rows: any = Array.from({ length: 15_750 }, (_, index) => index);
  const chunks: any = chunkRowsForPostgres(rows, { parametersPerRow: 11 });

  assert.ok(chunks.length > 1);
  assert.deepEqual(chunks.flat(), rows);
  assert.ok(chunks.every((chunk: any) => chunk.length * 11 <= 60_000));
});

test("PostgreSQL batching rejects invalid row widths", () => {
  assert.throws(
    () => chunkRowsForPostgres([1], { parametersPerRow: 0 }),
    /parametersPerRow must be a positive integer/,
  );
});
