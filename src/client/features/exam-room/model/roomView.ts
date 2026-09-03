import type { AssessmentMode } from "../../../../types/models/assessment.ts";
import type { ExamRoomMetadata, ExamRoomStudent, ExamRoomStudentStatus } from "../../../../types/contracts/exam-room.ts";
import type { ExamRoomStatusSearch } from "../../../../types/routes/admin-search.ts";
import type { AssignmentRoomStatus, RoomSummaryMetric, RoomVisibleStatus } from "../types.ts";

export const EXAM_ROOM_REFRESH_INTERVAL_MS = 3_000;
export const ASSIGNMENT_ROOM_REFRESH_INTERVAL_MS = 12_000;

const terminalStatuses = new Set<ExamRoomStudentStatus>([
  "submitted",
  "auto_submitted",
  "teacher_submitted",
  "policy_submitted",
  "review_required",
]);

const formalStatusTabs = [
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
] as const satisfies readonly ExamRoomStudentStatus[];

const assignmentStatusTabs = [
  "assignment_not_started",
  "assignment_in_progress",
  "assignment_second_ready",
  "assignment_submitted_once",
  "assignment_completed_twice",
] as const satisfies readonly AssignmentRoomStatus[];

const formalSummaryKeys = [
  "waiting_approval",
  "in_progress",
  "policy_suspended",
  "disconnected",
  "submitted",
  "teacher_submitted",
] as const satisfies readonly ExamRoomStudentStatus[];

const assignmentSummaryKeys = [
  "assignment_not_started",
  "assignment_in_progress",
  "assignment_submitted_once",
  "assignment_completed_twice",
] as const satisfies readonly AssignmentRoomStatus[];

export function isAssignmentRoom(room: Pick<ExamRoomMetadata, "mode">): boolean {
  return room.mode === "assignment";
}

export function assignmentStudentStatus(student: ExamRoomStudent): AssignmentRoomStatus {
  if (terminalStatuses.has(student.status) && student.attemptCount >= 2) return "assignment_completed_twice";
  if (terminalStatuses.has(student.status)) return "assignment_submitted_once";
  if (student.status === "in_progress") return "assignment_in_progress";
  if (student.status === "admitted" && student.attemptCount >= 2) return "assignment_second_ready";
  return "assignment_not_started";
}

export function visibleStudentStatus(student: ExamRoomStudent, mode: AssessmentMode): RoomVisibleStatus {
  return mode === "assignment" ? assignmentStudentStatus(student) : student.status;
}

export function roomStatusTabs(mode: AssessmentMode): readonly RoomVisibleStatus[] {
  return mode === "assignment" ? assignmentStatusTabs : formalStatusTabs;
}

export function roomRefreshInterval(mode: AssessmentMode): number {
  return mode === "assignment" ? ASSIGNMENT_ROOM_REFRESH_INTERVAL_MS : EXAM_ROOM_REFRESH_INTERVAL_MS;
}

export function displayStudentName(value: string): string {
  if (!value.includes("?") || !/\p{L}/u.test(value.replaceAll("?", ""))) return value;
  return value.replaceAll(/\?+/g, " ").replaceAll(/\s+/g, " ").trim();
}

export function filterRoomStudents(
  students: readonly ExamRoomStudent[],
  mode: AssessmentMode,
  query: string,
  status: ExamRoomStatusSearch | undefined,
): ExamRoomStudent[] {
  const normalizedQuery = query.normalize("NFKC").trim().toLocaleLowerCase();
  const allowedStatuses = roomStatusTabs(mode);
  const effectiveStatus = status && allowedStatuses.includes(status as RoomVisibleStatus) ? status : undefined;

  return students.filter((student) => {
    if (effectiveStatus && visibleStudentStatus(student, mode) !== effectiveStatus) return false;
    if (!normalizedQuery) return true;
    return `${student.studentNumber} ${displayStudentName(student.name)}`
      .normalize("NFKC")
      .toLocaleLowerCase()
      .includes(normalizedQuery);
  });
}

export function roomSummaryMetrics(
  room: Pick<ExamRoomMetadata, "mode" | "rosterCount">,
  students: readonly ExamRoomStudent[],
): RoomSummaryMetric[] {
  const counts = new Map<RoomVisibleStatus, number>();
  for (const student of students) {
    const status = visibleStudentStatus(student, room.mode);
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }

  if (room.mode === "assignment") {
    return [
      { key: "assignment_total", count: room.rosterCount },
      ...assignmentSummaryKeys.map((key) => ({ key, count: counts.get(key) ?? 0 })),
    ];
  }
  return formalSummaryKeys.map((key) => ({ key, count: counts.get(key) ?? 0 }));
}

export function selectableWaitingStudentNumbers(students: readonly ExamRoomStudent[]): string[] {
  return students
    .filter((student) => student.status === "waiting_approval")
    .map((student) => student.studentNumber);
}

export function reconcileWaitingSelection(
  selected: ReadonlySet<string>,
  students: readonly ExamRoomStudent[],
): ReadonlySet<string> {
  const waiting = new Set(selectableWaitingStudentNumbers(students));
  const next = new Set([...selected].filter((studentNumber) => waiting.has(studentNumber)));
  if (next.size === selected.size && [...next].every((studentNumber) => selected.has(studentNumber))) return selected;
  return next;
}

export function isResumeEligible(student: ExamRoomStudent): boolean {
  return student.status === "disconnected" || student.status === "policy_suspended";
}

export function isRetakeEligible(student: ExamRoomStudent): boolean {
  return terminalStatuses.has(student.status);
}
