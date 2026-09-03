import assert from "node:assert/strict";
import test from "node:test";

import { ROOM_COLLECTION_BATCH_SIZE } from "../src/server/student-exam-repository.ts";

test("PostgreSQL room collection keeps each grading transaction within a short bounded batch", () => {
  assert.equal(ROOM_COLLECTION_BATCH_SIZE, 10);
});
