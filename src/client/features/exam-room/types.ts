import type { AssessmentMode } from "../../../types/models/assessment.ts";
import type { ExamRoomStudent, ExamRoomStudentStatus } from "../../../types/contracts/exam-room.ts";
import type { ExamRoomStatusSearch } from "../../../types/routes/admin-search.ts";
import type { ExamTerminationProgress } from "../../shared/api/examTermination.ts";

export type AssignmentRoomStatus =
  | "assignment_not_started"
  | "assignment_in_progress"
  | "assignment_second_ready"
  | "assignment_submitted_once"
  | "assignment_completed_twice";

export type RoomVisibleStatus = ExamRoomStudentStatus | AssignmentRoomStatus;
export type RoomStatusFilter = ExamRoomStatusSearch | undefined;
export type RoomSummaryKey = RoomVisibleStatus | "assignment_total";

export interface RoomSummaryMetric {
  key: RoomSummaryKey;
  count: number;
}

export interface ExamRoomMutationScope {
  examCode: string;
  subjectId: string;
}

export interface RoomStudentCommand {
  csrfToken: string;
  studentNumber: string;
}

export interface RoomBulkAdmissionCommand {
  csrfToken: string;
  studentNumbers: readonly string[];
}

export interface RoomRetryFailureCommand {
  attemptId: string;
  csrfToken: string;
}

export type RoomTerminationProgress = ExamTerminationProgress;

export interface RoomTerminationCommand {
  csrfToken: string;
  mode: AssessmentMode;
  onProgress?: (progress: RoomTerminationProgress) => void;
}

export type RoomStudentActionTarget = {
  action: "resume" | "retake";
  student: ExamRoomStudent;
};
