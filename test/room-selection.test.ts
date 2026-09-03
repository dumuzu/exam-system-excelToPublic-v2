import assert from "node:assert/strict";
import test from "node:test";

import {
  reconcileWaitingSelection,
  selectableWaitingStudentNumbers,
} from "../src/client/features/exam-room/model/roomView.ts";

const students: any = [
  { studentNumber: "E24A001", status: "waiting_approval" },
  { studentNumber: "E24A002", status: "submitted" },
  { studentNumber: "E24A003", status: "policy_submitted" },
  { studentNumber: "E24A004", status: "waiting_approval" },
];

test("select all includes only students who are still waiting for approval", () => {
  assert.deepEqual(selectableWaitingStudentNumbers(students), ["E24A001", "E24A004"]);
});

test("selection reconciliation removes students who are no longer waiting", () => {
  assert.deepEqual(
    [...reconcileWaitingSelection(new Set(["E24A001", "E24A002", "E24A003"]), students)],
    ["E24A001"],
  );
});
