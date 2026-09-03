import assert from "node:assert/strict";
import test from "node:test";

import { normalizeStudentIdentity, validateStudentIdentity, validateStudentNumber } from "../src/core/student-identity.ts";

test("student identity normalises compatible Unicode and whitespace without changing the student number", () => {
  assert.deepEqual(
    normalizeStudentIdentity({ studentNumber: "  ００１-Ａ  ", name: "  Anil　K.  " }),
    { studentNumber: "001-A", name: "Anil K." },
  );
});

test("student-number-only verification preserves leading zeroes and does not require a name", () => {
  assert.deepEqual(validateStudentNumber({ studentNumber: " ００１-Ａ " }), { valid: true, value: { studentNumber: "001-A" } });
  assert.equal(validateStudentNumber({ studentNumber: "" }).valid, false);
});

test("student identity validation rejects missing or oversized identity fields", () => {
  assert.equal(validateStudentIdentity({ studentNumber: "", name: "Maya" }).valid, false);
  assert.equal(validateStudentIdentity({ studentNumber: "20260001", name: "" }).valid, false);
  assert.equal(validateStudentIdentity({ studentNumber: "A".repeat(33), name: "Maya" }).valid, false);
  assert.deepEqual(
    validateStudentIdentity({ studentNumber: "20260001", name: "Maya S." }),
    { valid: true, value: { studentNumber: "20260001", name: "Maya S." } },
  );
});
