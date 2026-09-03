import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  examRoomSnapshotSchema,
  type ExamRoomStudent,
} from "../src/types/contracts/exam-room.ts";
import {
  ASSIGNMENT_ROOM_REFRESH_INTERVAL_MS,
  EXAM_ROOM_REFRESH_INTERVAL_MS,
  assignmentStudentStatus,
  reconcileWaitingSelection,
  roomRefreshInterval,
  roomStatusTabs,
  selectableWaitingStudentNumbers,
} from "../src/client/features/exam-room/model/roomView.ts";

function student(overrides: Partial<ExamRoomStudent> = {}): ExamRoomStudent {
  return {
    studentNumber: "E24A001",
    name: "Student One",
    status: "not_entered",
    attemptCount: 0,
    arrivedAt: null,
    startedAt: null,
    deadlineAt: null,
    lastSeenAt: null,
    remainingSeconds: null,
    violationCount: 0,
    suspendedAt: null,
    ...overrides,
  };
}

test("room snapshots require resource-scoped subject and permission data", () => {
  const snapshot = examRoomSnapshotSchema.parse({
    room: {
      mode: "exam",
      titleJa: "表計算演習",
      rosterCount: 1,
      state: "active",
      subjectId: "subject-excel",
    },
    students: [student()],
    violationLimit: 3,
    permissions: ["view_room", "manage_admission"],
  });

  assert.equal(snapshot.room.subjectId, "subject-excel");
  assert.deepEqual(snapshot.permissions, ["view_room", "manage_admission"]);
  assert.throws(() => examRoomSnapshotSchema.parse({
    ...snapshot,
    room: { ...snapshot.room, subjectId: undefined },
  }));
  assert.throws(() => examRoomSnapshotSchema.parse({
    ...snapshot,
    permissions: ["view_room", "manage_everything"],
  }));
});

test("formal exams refresh every 3 seconds and assignments every 12 seconds", () => {
  assert.equal(EXAM_ROOM_REFRESH_INTERVAL_MS, 3_000);
  assert.equal(ASSIGNMENT_ROOM_REFRESH_INTERVAL_MS, 12_000);
  assert.equal(roomRefreshInterval("exam"), 3_000);
  assert.equal(roomRefreshInterval("assignment"), 12_000);
});

test("assignment rooms project attempt lifecycle into classroom progress", () => {
  assert.equal(assignmentStudentStatus(student()), "assignment_not_started");
  assert.equal(assignmentStudentStatus(student({ status: "in_progress", attemptCount: 1 })), "assignment_in_progress");
  assert.equal(assignmentStudentStatus(student({ status: "admitted", attemptCount: 2 })), "assignment_second_ready");
  assert.equal(assignmentStudentStatus(student({ status: "submitted", attemptCount: 1 })), "assignment_submitted_once");
  assert.equal(assignmentStudentStatus(student({ status: "teacher_submitted", attemptCount: 2 })), "assignment_completed_twice");
});

test("waiting selection reconciliation drops students whose server status changed", () => {
  const students = [
    student({ studentNumber: "E24A001", status: "waiting_approval" }),
    student({ studentNumber: "E24A002", status: "submitted" }),
    student({ studentNumber: "E24A003", status: "waiting_approval" }),
  ];
  assert.deepEqual(selectableWaitingStudentNumbers(students), ["E24A001", "E24A003"]);
  assert.deepEqual(
    [...reconcileWaitingSelection(new Set(["E24A001", "E24A002"]), students)],
    ["E24A001"],
  );
  const stable = new Set(["E24A001"]);
  assert.equal(reconcileWaitingSelection(stable, students), stable);
});

test("formal rooms expose every attempt state as an explicit filter tab", () => {
  assert.deepEqual(roomStatusTabs("exam"), [
    "not_entered",
    "waiting_approval",
    "admitted",
    "in_progress",
    "policy_suspended",
    "disconnected",
    "resume_ready",
    "submitted",
    "auto_submitted",
    "teacher_submitted",
    "policy_submitted",
    "expired",
    "review_required",
  ]);
});

test("room and list actions share one bounded termination orchestrator", async () => {
  const [termination, roomApi, examApi] = await Promise.all([
    readFile(new URL("../src/client/shared/api/examTermination.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/client/features/exam-room/api/examRoomApi.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/client/features/exams/api/examApi.ts", import.meta.url), "utf8"),
  ]);

  assert.match(termination, /const maximumPasses = 40/);
  assert.match(termination, /const maximumStalledPasses = 2/);
  assert.match(termination, /while \(!response\.exam\.completed\)/);
  assert.match(termination, /ROOM_COLLECTION_STALLED/);
  assert.match(termination, /mode !== "assignment"/);
  assert.match(roomApi, /executeExamTermination\(/);
  assert.match(examApi, /executeExamTermination\(/);
  assert.doesNotMatch(roomApi, /while \(!response\.exam\.completed\)/);
  assert.doesNotMatch(examApi, /while \(!response\.exam\.completed\)/);
});

test("an open room drops cached roster data after access loss and serializes admissions", async () => {
  const [route, table, failures] = await Promise.all([
    readFile(new URL("../src/client/features/exam-room/routes/examRoom.lazy.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/client/features/exam-room/components/AttendanceTable.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/client/features/exam-room/components/TerminationFailuresPanel.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(route, /roomAccessFailureStatuses = new Set\(\[401, 403, 404\]\)/);
  assert.match(route, /currentAccessFailure \? undefined : roomQuery\.data/);
  assert.match(route, /removeQueries\(\{ queryKey: adminExamQueryKeys\.room\(examCode\), exact: true \}\)/);
  assert.match(route, /removeQueries\(\{ queryKey: adminExamQueryKeys\.roomFailures\(examCode\), exact: true \}\)/);
  assert.match(route, /removeQueries\(\{ queryKey: adminSessionQueryKey, exact: true \}\)/);
  assert.match(route, /globalThis\.location\.replace\("\/admin\/login\/"\)/);
  assert.match(route, /if \(admissionLockRef\.current\) return/);
  assert.match(route, /backgroundSyncFailed/);
  assert.match(table, /disabled=\{admissionPending \|\| rowPending\}/);
  assert.doesNotMatch(failures, /aria-live="polite" className="terminationFailureList"/);
  assert.match(failures, /previousCountRef\.current !== failures\.length/);
});
