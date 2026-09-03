import {
  examRoomCodeSchema,
  examRoomSnapshotSchema,
  examRoomStudentNumberSchema,
  retryRoomTerminationFailureResponseSchema,
  roomAdmissionResponseSchema,
  roomBulkAdmissionRequestSchema,
  roomBulkAdmissionResponseSchema,
  roomResumeResponseSchema,
  roomRetakeResponseSchema,
  roomTerminationFailureSchema,
  roomTerminationFailureListResponseSchema,
  type ExamRoomSnapshot,
  type RoomAdmissionResponse,
  type RoomBulkAdmissionResponse,
  type RoomResumeResponse,
  type RoomRetakeResponse,
  type RoomTerminationFailure,
  type RoomTerminationResult,
} from "../../../../types/contracts/exam-room.ts";
import {
  examLifecycleConfirmationSchema,
} from "../../../../types/contracts/exam-events.ts";
import { executeExamTermination } from "../../../shared/api/examTermination.ts";
import { requestJson } from "../../../shared/api/httpClient.ts";
import type {
  RoomBulkAdmissionCommand,
  RoomRetryFailureCommand,
  RoomStudentCommand,
  RoomTerminationCommand,
} from "../types.ts";

interface ExamRoomRequest {
  examCode: string;
}

function roomPath(examCode: string): string {
  return `/api/admin/exams/${encodeURIComponent(examRoomCodeSchema.parse(examCode))}`;
}

function protectedHeaders(csrfToken: string): HeadersInit {
  return {
    "content-type": "application/json",
    "x-csrf-token": csrfToken,
  };
}

export function fetchExamRoomSnapshot(examCode: string): Promise<ExamRoomSnapshot> {
  return requestJson(`${roomPath(examCode)}/attendance`, {}, examRoomSnapshotSchema);
}

export async function fetchRoomTerminationFailures(examCode: string): Promise<RoomTerminationFailure[]> {
  const response = await requestJson(
    `${roomPath(examCode)}/termination-failures`,
    {},
    roomTerminationFailureListResponseSchema,
  );
  return response.failures;
}

export function admitRoomStudent(
  request: ExamRoomRequest & RoomStudentCommand,
): Promise<RoomAdmissionResponse> {
  const studentNumber = examRoomStudentNumberSchema.parse(request.studentNumber);
  return requestJson(
    `${roomPath(request.examCode)}/students/${encodeURIComponent(studentNumber)}/admit`,
    { method: "POST", headers: protectedHeaders(request.csrfToken), body: "{}" },
    roomAdmissionResponseSchema,
  );
}

export function admitSelectedRoomStudents(
  request: ExamRoomRequest & RoomBulkAdmissionCommand,
): Promise<RoomBulkAdmissionResponse> {
  const body = roomBulkAdmissionRequestSchema.parse({ studentNumbers: request.studentNumbers });
  return requestJson(
    `${roomPath(request.examCode)}/admit-selected`,
    { method: "POST", headers: protectedHeaders(request.csrfToken), body: JSON.stringify(body) },
    roomBulkAdmissionResponseSchema,
  );
}

export function authorizeRoomResume(
  request: ExamRoomRequest & RoomStudentCommand,
): Promise<RoomResumeResponse> {
  const studentNumber = examRoomStudentNumberSchema.parse(request.studentNumber);
  return requestJson(
    `${roomPath(request.examCode)}/students/${encodeURIComponent(studentNumber)}/resume`,
    { method: "POST", headers: protectedHeaders(request.csrfToken), body: "{}" },
    roomResumeResponseSchema,
  );
}

export function authorizeRoomRetake(
  request: ExamRoomRequest & RoomStudentCommand,
): Promise<RoomRetakeResponse> {
  const studentNumber = examRoomStudentNumberSchema.parse(request.studentNumber);
  return requestJson(
    `${roomPath(request.examCode)}/students/${encodeURIComponent(studentNumber)}/retake`,
    { method: "POST", headers: protectedHeaders(request.csrfToken), body: "{}" },
    roomRetakeResponseSchema,
  );
}

export async function retryRoomTerminationFailure(
  request: ExamRoomRequest & RoomRetryFailureCommand,
): Promise<RoomTerminationResult> {
  const body = examLifecycleConfirmationSchema.parse({ confirmationCode: request.examCode });
  const attemptId = roomTerminationFailureSchema.shape.attemptId.parse(request.attemptId);
  const response = await requestJson(
    `${roomPath(request.examCode)}/termination-failures/${encodeURIComponent(attemptId)}/retry`,
    { method: "POST", headers: protectedHeaders(request.csrfToken), body: JSON.stringify(body) },
    retryRoomTerminationFailureResponseSchema,
  );
  return response.exam;
}

export async function runRoomTermination(
  request: ExamRoomRequest & RoomTerminationCommand,
): Promise<RoomTerminationResult> {
  return executeExamTermination({
    csrfToken: request.csrfToken,
    examCode: request.examCode,
    mode: request.mode,
    ...(request.onProgress ? { onProgress: request.onProgress } : {}),
  });
}
