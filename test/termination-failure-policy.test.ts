import assert from "node:assert/strict";
import test from "node:test";

import { classifyTerminationFailure } from "../src/server/termination-failure-policy.ts";

test("collection failure diagnostics expose stable codes without leaking database details", () => {
  assert.deepEqual(classifyTerminationFailure({ code: "PAPER_NOT_PREPARED" }), {
    code: "PAPER_NOT_PREPARED",
    message: "The prepared answer sheet is incomplete.",
  });

  const hidden: any = classifyTerminationFailure({
    code: "23505",
    message: "duplicate key value violates unique constraint submissions_attempt_id_key",
    detail: "Key (attempt_id)=(secret-id) already exists.",
  });
  assert.deepEqual(hidden, {
    code: "COLLECTION_PROCESSING_FAILED",
    message: "The answer sheet could not be collected safely.",
  });
  assert.doesNotMatch(JSON.stringify(hidden), /secret-id|submissions_attempt_id_key/);
});
