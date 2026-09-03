import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("the server expiry scan also retires expired active browser sessions", async () => {
  const source: any = await readFile(
    new URL("../src/server/student-exam-repository.ts", import.meta.url),
    "utf8",
  );
  const method: any = source.slice(source.lastIndexOf("async submitExpiredAttempts"), source.lastIndexOf("async recordProctorEvent"));

  assert.match(
    method,
    /UPDATE active_sessions SET status='expired' WHERE status='active' AND expires_at<=\$1/,
  );
});
