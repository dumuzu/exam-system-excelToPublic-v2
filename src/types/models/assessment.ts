import { z } from "zod";

export const assessmentModeSchema = z.enum(["exam", "assignment"]);
export const assessmentTypeKeySchema = z.string().min(1).max(100);
export const registeredAssessmentTypeKeySchema = z.enum(["excel_formula", "manual_questions"]);
export const examDifficultySchema = z.enum(["easy", "normal", "hard", "hell", "teacher_authored"]);
export const preparationStatusSchema = z.enum(["pending", "generating", "validating", "ready", "failed"]);

export type AssessmentMode = z.infer<typeof assessmentModeSchema>;
export type AssessmentTypeKey = z.infer<typeof assessmentTypeKeySchema>;
export type ExamDifficulty = z.infer<typeof examDifficultySchema>;
export type PreparationStatus = z.infer<typeof preparationStatusSchema>;
