import { z } from "zod";

import { assessmentModeSchema, preparationStatusSchema } from "../models/assessment.ts";

export const examEventContractSchema = z.object({
  code: z.string().regex(/^[A-Za-z0-9-]{1,50}$/),
  titleJa: z.string().min(1).max(200),
  state: z.enum(["draft", "published", "active", "closed", "archived"]),
  mode: assessmentModeSchema,
  preparationStatus: preparationStatusSchema,
  rosterCount: z.number().int().nonnegative(),
  waitingCount: z.number().int().nonnegative(),
  inProgressCount: z.number().int().nonnegative(),
  submittedCount: z.number().int().nonnegative(),
  durationMinutes: z.number().nonnegative().nullable(),
  createdAt: z.string().nullable(),
  subjectId: z.string().min(1).max(100),
  termination: z.object({
    terminatedAt: z.string(),
    terminatedBy: z.string(),
  }).nullable(),
});

export const examEventListResponseSchema = z.object({ exams: z.array(examEventContractSchema) });

export const terminationCollectionResponseSchema = z.object({
  collection: z.object({
    requestedAt: z.string(),
    requestedBy: z.string(),
    collectUntil: z.string().min(1),
    status: z.enum(["collecting", "processing", "completed"]),
  }),
});

export const terminationResponseSchema = z.object({
  exam: z.object({
    code: z.string().regex(/^[A-Za-z0-9-]{1,50}$/),
    state: z.enum(["draft", "published", "active", "closed", "archived"]),
    termination: z.object({ terminatedAt: z.string(), terminatedBy: z.string() }).nullable(),
    autoSubmittedCount: z.number().int().nonnegative(),
    teacherSubmittedCount: z.number().int().nonnegative(),
    failedSubmissionCount: z.number().int().nonnegative(),
    completed: z.boolean(),
    pendingSubmissionCount: z.number().int().nonnegative().default(0),
    processedThisBatch: z.number().int().nonnegative().default(0),
  }),
});

export const examLifecycleConfirmationSchema = z.object({
  confirmationCode: z.string().regex(/^[A-Za-z0-9-]{1,50}$/),
}).strict();

export const deleteExamResponseSchema = z.object({
  deleted: z.literal(true),
  code: z.string().regex(/^[A-Za-z0-9-]{1,50}$/),
});

export type ExamEventContract = z.infer<typeof examEventContractSchema>;
