import assert from "node:assert/strict";
import test from "node:test";

import { isTerminalStudentEntryStatus, resolveStudentEntryStatus } from "../src/core/student-entry-state.ts";

test("student entry state distinguishes waiting, starting, resuming and terminal attempts", () => {
  assert.equal(resolveStudentEntryStatus({ attemptStatus: "waiting", approvalStatus: "waiting" }), "waiting_approval");
  assert.equal(resolveStudentEntryStatus({ attemptStatus: "waiting", approvalStatus: "approved" }), "admitted");
  assert.equal(resolveStudentEntryStatus({ attemptStatus: "in_progress", approvalStatus: "approved" }), "resume_available");
  assert.equal(resolveStudentEntryStatus({ attemptStatus: "policy_suspended", approvalStatus: "approved" }), "policy_suspended");
  assert.equal(resolveStudentEntryStatus({ attemptStatus: "submitted", approvalStatus: "approved" }), "submitted");
  assert.equal(resolveStudentEntryStatus({ attemptStatus: "teacher_submitted", approvalStatus: "approved" }), "teacher_submitted");
  assert.equal(resolveStudentEntryStatus({ attemptStatus: "policy_submitted", approvalStatus: "approved" }), "policy_submitted");
  assert.equal(isTerminalStudentEntryStatus("policy_submitted"), true);
  assert.equal(isTerminalStudentEntryStatus("resume_available"), false);
  assert.equal(isTerminalStudentEntryStatus("policy_suspended"), false);
  assert.equal(isTerminalStudentEntryStatus("teacher_submitted"), true);
});
