import { z } from "zod";

function optionalText(value: unknown, maximumLength: number, pattern?: RegExp): string | undefined {
  if (typeof value !== "string" || value.length === 0 || value.length > maximumLength) return undefined;
  return pattern && !pattern.test(value) ? undefined : value;
}

function optionalPage(value: unknown): number | undefined {
  const numeric = typeof value === "number" || typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isSafeInteger(numeric) && numeric > 1 && numeric <= 10_000 ? numeric : undefined;
}

const subjectIdSearchSchema = z.preprocess((value) => optionalText(value, 100), z.string().optional());
const querySearchSchema = z.preprocess((value) => optionalText(value, 100), z.string().optional());
const pageSearchSchema = z.preprocess(optionalPage, z.number().int().optional());

export const dashboardSearchSchema = z.object({ subjectId: subjectIdSearchSchema });
export const authoringSearchSchema = z.object({
  subjectId: subjectIdSearchSchema,
  assessmentTypeKey: z.preprocess(
    (value) => ["excel_formula", "manual_questions"].includes(String(value)) ? value : undefined,
    z.enum(["excel_formula", "manual_questions"]).optional(),
  ),
  // 兼容旧版出题页书签；解析后统一为类型安全的科目与出题能力状态。
  subject: subjectIdSearchSchema,
}).transform(({ assessmentTypeKey, subject, subjectId }) => ({ assessmentTypeKey, subjectId: subjectId ?? subject }));
export const accountsSearchSchema = z.object({ page: pageSearchSchema });

export const examsSearchSchema = z.object({
  subjectId: subjectIdSearchSchema,
  status: z.preprocess(
    (value) => ["active", "preparing", "closed"].includes(String(value)) ? value : undefined,
    z.enum(["active", "preparing", "closed"]).optional(),
  ),
  query: querySearchSchema,
  page: pageSearchSchema,
});

export const resultsSearchSchema = z.object({
  subjectId: subjectIdSearchSchema,
  examId: z.preprocess((value) => optionalText(value, 50, /^[A-Za-z0-9-]+$/), z.string().optional()),
  status: z.preprocess(
    (value) => ["graded", "review_required", "pending", "failed"].includes(String(value)) ? value : undefined,
    z.enum(["graded", "review_required", "pending", "failed"]).optional(),
  ),
  query: querySearchSchema,
  page: pageSearchSchema,
});

const examRoomStatusValues = [
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
  "assignment_not_started",
  "assignment_in_progress",
  "assignment_second_ready",
  "assignment_submitted_once",
  "assignment_completed_twice",
] as const;

export const examRoomSearchSchema = z.object({
  query: querySearchSchema,
  status: z.preprocess(
    (value) => examRoomStatusValues.includes(value as typeof examRoomStatusValues[number]) ? value : undefined,
    z.enum(examRoomStatusValues).optional(),
  ),
});

export type DashboardSearch = z.infer<typeof dashboardSearchSchema>;
export type AuthoringSearch = z.infer<typeof authoringSearchSchema>;
export type AccountsSearch = z.infer<typeof accountsSearchSchema>;
export type ExamsSearch = z.infer<typeof examsSearchSchema>;
export type ResultsSearch = z.infer<typeof resultsSearchSchema>;
export type ExamRoomSearch = z.infer<typeof examRoomSearchSchema>;
export type ExamRoomStatusSearch = NonNullable<ExamRoomSearch["status"]>;
