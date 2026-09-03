import { z } from "zod";

const optionalNumberSchema = z.preprocess(
  (value) => value === null ? undefined : value,
  z.number().optional(),
);

const optionalStringSchema = z.preprocess(
  (value) => value === null ? undefined : value,
  z.string().optional(),
);

export const warningEventSchema = z.object({
  attemptNumber: optionalNumberSchema,
  eventType: optionalStringSchema,
  occurredAt: z.string(),
});

export const policySuspensionEventSchema = z.object({
  attemptNumber: optionalNumberSchema,
  status: optionalStringSchema,
  suspendedAt: z.string(),
  resumedAt: optionalStringSchema,
  collectedAt: optionalStringSchema,
  resumedBy: optionalStringSchema,
  collectedBy: optionalStringSchema,
  remainingSeconds: optionalNumberSchema,
});

export const forcedSubmissionEventSchema = z.object({
  attemptNumber: optionalNumberSchema,
  submissionType: optionalStringSchema,
  submittedAt: z.string(),
});

export const resultSummarySchema = z.object({
  studentNumber: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  highestScore: z.number().nullable().default(null),
  highestMaximumScore: z.number().nullable().default(null),
  attemptStatus: z.string().default("not_started"),
  attemptCount: z.number().int().nonnegative().default(0),
  score: z.number().nullable().default(null),
  maximumScore: z.number().nullable().default(null),
  adjusted: z.boolean().default(false),
  choiceCorrect: z.number().int().nonnegative().default(0),
  choiceTotal: z.number().int().nonnegative().default(0),
  formulaCorrect: z.number().int().nonnegative().default(0),
  formulaTotal: z.number().int().nonnegative().default(0),
  warningCount: z.number().int().nonnegative().default(0),
  policySuspensionCount: z.number().int().nonnegative().default(0),
  forcedSubmissionCount: z.number().int().nonnegative().default(0),
  policySubmissionCount: z.number().int().nonnegative().default(0),
  warningEvents: z.array(warningEventSchema).default([]),
  policySuspensions: z.array(policySuspensionEventSchema).default([]),
  forcedSubmissionEvents: z.array(forcedSubmissionEventSchema).default([]),
  questionResults: z.array(z.object({
    questionKey: z.string(),
    resultStatus: z.string(),
  })).default([]),
  gradingStatus: z.enum(["graded", "review_required", "pending", "failed"]).nullable().default(null),
  submittedAt: z.string().nullable().default(null),
});

export const resultListResponseSchema = z.object({ results: z.array(resultSummarySchema) });

export const questionResultSchema = z.object({
  gradeResultId: z.string().min(1),
  questionKey: z.string().min(1),
  questionMode: z.string().min(1),
  prompt: z.record(z.string(), z.unknown()).nullable().default(null),
  answer: z.unknown(),
  formula: z.string().default(""),
  referenceAnswer: z.unknown(),
  automaticScore: z.number(),
  awardedScore: z.number(),
  maximumScore: z.number().nonnegative(),
  resultStatus: z.string().min(1),
  adjustment: z.object({
    previousScore: z.number(),
    newScore: z.number(),
    reason: z.string(),
    adjustedBy: z.string(),
    adjustedAt: z.string(),
  }).nullable().optional(),
});

export const resultDetailSchema = z.object({
  student: z.object({
    studentNumber: z.string().min(1).max(100),
    name: z.string().min(1).max(200),
  }),
  attempt: z.object({ status: z.string(), submittedAt: z.string() }),
  questions: z.array(questionResultSchema),
});

export const resultDetailResponseSchema = z.object({ result: resultDetailSchema });

export const gradeAdjustmentResponseSchema = z.object({
  adjustment: z.object({
    previousScore: z.number(),
    newScore: z.number(),
    reason: z.string(),
    adjustedBy: z.string().optional(),
    adjustedAt: z.string(),
  }),
});

export const gradeAdjustmentBodySchema = z.object({
  newScore: z.number().finite().min(0).max(999.99),
  reason: z.string().transform((value) => value.trim()).pipe(z.string().min(3).max(500)),
}).strict();

export const gradeResultIdSchema = z.string().uuid();

export type ResultFilter = "all" | "graded" | "review_required" | "pending";
export type WarningEvent = z.infer<typeof warningEventSchema>;
export type PolicySuspensionEvent = z.infer<typeof policySuspensionEventSchema>;
export type ForcedSubmissionEvent = z.infer<typeof forcedSubmissionEventSchema>;
export type ResultSummary = z.infer<typeof resultSummarySchema>;
export type QuestionResult = z.infer<typeof questionResultSchema>;
export type ResultDetail = z.infer<typeof resultDetailSchema>;
