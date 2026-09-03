import { z } from "zod";
import { studentDisplayLocaleSchema } from "../models/locale.ts";

export const studentIdentitySchema = z.object({
  examCode: z.string().min(1).max(50),
  studentNumber: z.string().min(1).max(32),
});

export const studentEntryStatusSchema = z.enum([
  "waiting_approval",
  "admitted",
  "resume_available",
  "policy_suspended",
  "submitted",
  "auto_submitted",
  "teacher_submitted",
  "policy_submitted",
  "review_required",
]);

export const studentExperienceSchema = z.object({
  mode: z.enum(["exam", "assignment"]),
  requiresAdmission: z.boolean(),
  requiresFullscreen: z.boolean(),
  hasTimeLimit: z.boolean(),
  proctoringEnabled: z.boolean(),
  autosaveEnabled: z.boolean(),
  sharedPaper: z.boolean(),
  randomizeQuestionOrder: z.boolean(),
  revealScoreAfterSubmission: z.boolean(),
  maximumAttempts: z.number().int().positive().nullable(),
});

export const studentVerificationResponseSchema = z.object({
  status: studentEntryStatusSchema,
  exam: z.object({
    code: z.string().min(1),
    titleJa: z.string(),
    durationMinutes: z.number().int().nonnegative().nullable(),
    mode: z.enum(["exam", "assignment"]),
    studentLocale: studentDisplayLocaleSchema,
  }),
  student: z.object({
    studentNumber: z.string().min(1),
    name: z.string(),
  }),
  experience: studentExperienceSchema,
  csrfToken: z.string().min(1),
});

export type StudentIdentity = z.infer<typeof studentIdentitySchema>;
export type StudentVerificationResponse = z.infer<typeof studentVerificationResponseSchema>;
