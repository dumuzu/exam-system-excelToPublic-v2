import { z } from "zod";

import { adminPermissionSchema } from "./admin-auth.ts";
import { terminationResponseSchema } from "./exam-events.ts";
import { assessmentModeSchema } from "../models/assessment.ts";

export const examRoomCodeSchema = z.string().regex(/^[A-Za-z0-9-]{1,50}$/);
export const examRoomStudentNumberSchema = z.string().regex(/^[A-Za-z0-9-]{1,32}$/);

export const examRoomStudentStatusSchema = z.enum([
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

export const examRoomMetadataSchema = z.object({
  mode: assessmentModeSchema,
  titleJa: z.string().min(1).max(200),
  rosterCount: z.number().int().nonnegative(),
  state: z.enum(["draft", "published", "active", "closed", "archived"]),
  // 房间资源必须携带所属科目，避免多科目教师误用会话级权限。
  subjectId: z.string().min(1).max(100),
});

const nullableTimestampSchema = z.string().min(1).nullable();

export const examRoomStudentSchema = z.object({
  studentNumber: examRoomStudentNumberSchema,
  name: z.string().max(200),
  status: examRoomStudentStatusSchema,
  attemptCount: z.number().int().nonnegative(),
  arrivedAt: nullableTimestampSchema,
  startedAt: nullableTimestampSchema,
  deadlineAt: nullableTimestampSchema,
  lastSeenAt: nullableTimestampSchema,
  submittedAt: nullableTimestampSchema.optional(),
  remainingSeconds: z.number().int().nonnegative().nullable(),
  violationCount: z.number().int().nonnegative(),
  suspendedAt: nullableTimestampSchema,
});

export const examRoomSnapshotSchema = z.object({
  room: examRoomMetadataSchema,
  students: z.array(examRoomStudentSchema),
  violationLimit: z.number().int().positive(),
  // 权限由服务端针对当前考试资源计算，客户端不得使用跨科目权限并集替代。
  permissions: z.array(adminPermissionSchema),
});

export const roomTerminationFailureSchema = z.object({
  attemptId: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i),
  studentNumber: examRoomStudentNumberSchema,
  name: z.string().max(200),
  attemptNumber: z.number().int().positive(),
  errorCode: z.string().min(1).max(100),
  errorMessage: z.string().min(1).max(2_000),
  occurrenceCount: z.number().int().positive(),
  firstFailedAt: nullableTimestampSchema.default(null),
  lastFailedAt: nullableTimestampSchema.default(null),
  lastRetriedAt: nullableTimestampSchema.default(null),
  lastRetriedBy: z.string().max(100).nullable().default(null),
});

export const roomTerminationFailureListResponseSchema = z.object({
  failures: z.array(roomTerminationFailureSchema),
});

export const roomBulkAdmissionRequestSchema = z.object({
  studentNumbers: z.array(examRoomStudentNumberSchema).min(1).max(200),
}).strict();

export const roomAdmissionResponseSchema = z.object({
  studentNumber: examRoomStudentNumberSchema,
  status: z.literal("admitted"),
});

export const roomBulkAdmissionResponseSchema = z.object({
  admittedCount: z.number().int().nonnegative(),
});

export const roomResumeResponseSchema = z.object({
  studentNumber: examRoomStudentNumberSchema,
  status: z.enum(["in_progress", "resume_ready"]),
  deadlineAt: z.string().min(1).optional(),
});

export const roomRetakeResponseSchema = z.object({
  studentNumber: examRoomStudentNumberSchema,
  status: z.literal("admitted"),
  attemptCount: z.number().int().positive(),
});

export const retryRoomTerminationFailureResponseSchema = terminationResponseSchema;

export type ExamRoomMetadata = z.infer<typeof examRoomMetadataSchema>;
export type ExamRoomStudent = z.infer<typeof examRoomStudentSchema>;
export type ExamRoomSnapshot = z.infer<typeof examRoomSnapshotSchema>;
export type ExamRoomStudentStatus = z.infer<typeof examRoomStudentStatusSchema>;
export type RoomTerminationFailure = z.infer<typeof roomTerminationFailureSchema>;
export type RoomAdmissionResponse = z.infer<typeof roomAdmissionResponseSchema>;
export type RoomBulkAdmissionResponse = z.infer<typeof roomBulkAdmissionResponseSchema>;
export type RoomResumeResponse = z.infer<typeof roomResumeResponseSchema>;
export type RoomRetakeResponse = z.infer<typeof roomRetakeResponseSchema>;
export type RoomTerminationResult = z.infer<typeof terminationResponseSchema>["exam"];
