import { z } from "zod";

import {
  assessmentModeSchema,
  assessmentTypeKeySchema,
  examDifficultySchema,
  preparationStatusSchema,
} from "../models/assessment.ts";
import { manualPaperRuleSchema, manualQuestionSchema } from "../models/manual-question.ts";

const uuidSchema = z.string().uuid();
const examCodeSchema = z.string().regex(/^[A-Za-z0-9-]{1,50}$/);
const contractDetailsSchema = z.record(z.string(), z.unknown());

export const authoringContractMessageSchema = z.object({
  code: z.string().min(1).max(100),
  message: z.string().min(1),
  details: contractDetailsSchema.optional(),
});

export const authoringFunctionSchema = z.object({
  name: z.string().min(1).max(32),
  category: z.string().min(1).max(100),
  modes: z.array(z.enum(["choice", "formula"])).min(1),
});

export const authoringFunctionListResponseSchema = z.object({
  functions: z.array(authoringFunctionSchema),
});

const difficultyDefinitionSchema = z.object({
  key: z.enum(["easy", "normal", "hard", "hell"]),
  choiceQuestionCount: z.number().int().nonnegative(),
  formulaQuestionCount: z.number().int().nonnegative(),
  doubleQuestionCount: z.number().int().nonnegative(),
  tripleQuestionCount: z.number().int().nonnegative(),
});

const formalExamModeDefinitionSchema = z.object({
  key: z.literal("exam"),
  configurable: z.literal(false),
  formulaQuestionCount: z.number().int().nonnegative(),
  formulaQuestionsPerGroup: z.number().int().positive(),
  defaultDifficulty: z.enum(["easy", "normal", "hard", "hell"]),
  difficulties: z.array(difficultyDefinitionSchema).min(1),
});

const assignmentModeDefinitionSchema = z.object({
  key: z.literal("assignment"),
  configurable: z.literal(true),
  defaultQuestionsPerFunction: z.number().int().positive(),
  questionsPerFunctionOptions: z.array(z.number().int().positive()).min(1),
  maximumFormulaFunctionCount: z.number().int().positive(),
  formulaQuestionsPerGroup: z.number().int().positive(),
});

const manualModeDefinitionSchema = z.object({
  key: z.literal("exam"),
  configurable: z.literal(true),
  authoringKind: z.literal("manual_questions"),
});

export const authoringModeDefinitionSchema = z.union([
  formalExamModeDefinitionSchema,
  assignmentModeDefinitionSchema,
  manualModeDefinitionSchema,
]);

export const authoringModeListResponseSchema = z.object({
  modes: z.array(authoringModeDefinitionSchema).min(1),
});

const selectedFunctionsSchema = z.array(z.string().min(1).max(32)).min(1).max(100);
const formalExamDurationSchema = z.number().int().min(1).max(240);
const assignmentOptionsSchema = z.object({
  formulaQuestionCountMode: z.literal("per_function").optional(),
  formulaQuestionCount: z.number().int().nonnegative().optional(),
  questionsPerFunction: z.number().int().positive().optional(),
  choiceQuestionCount: z.number().int().nonnegative().optional(),
}).strict();

const excelExamAuthoringPreviewBodySchema = z.object({
  mode: z.literal("exam").default("exam"),
  durationMinutes: formalExamDurationSchema.default(90),
  difficulty: z.enum(["easy", "normal", "hard", "hell"]),
  assignmentOptions: assignmentOptionsSchema,
  selectedFunctions: selectedFunctionsSchema,
}).strict();

const excelAssignmentAuthoringPreviewBodySchema = z.object({
  mode: z.literal("assignment"),
  durationMinutes: z.null().default(null),
  difficulty: z.enum(["easy", "normal", "hard", "hell"]),
  assignmentOptions: assignmentOptionsSchema,
  selectedFunctions: selectedFunctionsSchema,
}).strict();

export const excelAuthoringPreviewBodySchema = z.union([
  excelExamAuthoringPreviewBodySchema,
  excelAssignmentAuthoringPreviewBodySchema,
]);

export const manualAuthoringPreviewBodySchema = z.object({
  mode: z.literal("exam"),
  durationMinutes: formalExamDurationSchema.default(90),
  questions: z.array(manualQuestionSchema).min(1),
  paperRule: manualPaperRuleSchema.default({ strategy: "all_questions" }),
}).strict().superRefine((value, context) => {
  if (value.paperRule.strategy === "random_subset" && value.paperRule.questionCount > value.questions.length) {
    context.addIssue({
      code: "custom",
      message: "The published question count cannot exceed the question bank size.",
      path: ["paperRule", "questionCount"],
    });
  }
});

export const authoringPreviewBodySchema = z.union([
  excelAuthoringPreviewBodySchema,
  manualAuthoringPreviewBodySchema,
]);

export const authoringConfigurationBodySchema = z.union([
  excelExamAuthoringPreviewBodySchema.extend({ name: z.string().trim().min(1).max(100) }),
  excelAssignmentAuthoringPreviewBodySchema.extend({ name: z.string().trim().min(1).max(100) }),
  manualAuthoringPreviewBodySchema.extend({ name: z.string().trim().min(1).max(100) }),
]);

export const publishAssessmentBodySchema = z.union([
  excelExamAuthoringPreviewBodySchema.extend({
    name: z.string().trim().min(1).max(100),
    rosterCsv: z.string().min(1),
  }),
  excelAssignmentAuthoringPreviewBodySchema.extend({
    name: z.string().trim().min(1).max(100),
    rosterCsv: z.string().min(1),
  }),
  manualAuthoringPreviewBodySchema.extend({
    name: z.string().trim().min(1).max(100),
    rosterCsv: z.string().min(1),
  }),
]);

const assessmentCoverageSchema = z.object({
  selected: z.array(z.string().min(1).max(32)),
  uncovered: z.array(z.string().min(1).max(32)).optional(),
  allocations: z.array(z.object({
    functionName: z.string().min(1).max(32),
    count: z.number().int().nonnegative(),
    companionCandidateCount: z.number().int().nonnegative().optional(),
  })).optional(),
});

export const composedAssessmentPlanSchema = z.object({
  mode: assessmentModeSchema,
  difficulty: examDifficultySchema.nullable().optional(),
  assessmentTypeKey: assessmentTypeKeySchema.optional(),
  assignmentOptions: contractDetailsSchema.nullable().optional(),
  questionCounts: z.object({
    choice: z.number().int().nonnegative(),
    formula: z.number().int().nonnegative(),
    formulaGroups: z.number().int().nonnegative(),
  }),
  coverage: assessmentCoverageSchema,
  questions: z.array(manualQuestionSchema).optional(),
  manualPaperRule: manualPaperRuleSchema.optional(),
  questionBankSize: z.number().int().nonnegative().optional(),
  manualQuestionCounts: z.record(z.string(), z.number().int().nonnegative()).optional(),
}).passthrough();

export const publicationAuditSchema = z.object({
  ok: z.boolean(),
  status: z.string().min(1),
  version: z.string().min(1),
  auditedAt: z.string().min(1),
  blueprints: z.array(contractDetailsSchema),
}).passthrough();

export const authoringPreviewResponseSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    errors: z.array(authoringContractMessageSchema),
    warnings: z.array(authoringContractMessageSchema),
    plan: composedAssessmentPlanSchema,
    publicationAudit: publicationAuditSchema,
  }),
  z.object({
    ok: z.literal(false),
    errors: z.array(authoringContractMessageSchema),
    warnings: z.array(authoringContractMessageSchema),
    plan: z.null(),
    publicationAudit: publicationAuditSchema.nullable(),
  }),
]);

export const authoringConfigurationSchema = z.object({
  id: uuidSchema,
  name: z.string().min(1).max(100),
  mode: assessmentModeSchema,
  durationMinutes: formalExamDurationSchema.nullable(),
  assignmentOptions: contractDetailsSchema,
  selectedFunctions: z.array(z.string().min(1).max(32)),
  plan: composedAssessmentPlanSchema,
  createdBy: z.string().min(1).max(100),
  subjectId: z.string().min(1).max(100),
  ownerAccountId: z.string().min(1).max(200),
  assessmentTypeKey: assessmentTypeKeySchema,
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  lastUsedAt: z.string().min(1).nullable(),
});

export const authoringConfigurationListResponseSchema = z.object({
  configurations: z.array(authoringConfigurationSchema),
});

export const authoringConfigurationResponseSchema = z.object({
  configuration: authoringConfigurationSchema,
  warnings: z.array(authoringContractMessageSchema).optional(),
});

export const preparationSchema = z.object({
  status: preparationStatusSchema,
  rosterCount: z.number().int().nonnegative(),
  plannedQuestionCount: z.number().int().nonnegative(),
  generatedQuestionCount: z.number().int().nonnegative(),
  percent: z.number().int().min(0).max(100),
  errorSummary: contractDetailsSchema,
});

export const preparationResponseSchema = z.object({ preparation: preparationSchema });

export const preparationStepBodySchema = z.object({
  batchSize: z.number().int().min(1).max(25),
}).strict();

export const publishedAssessmentSchema = z.object({
  code: examCodeSchema,
  titleJa: z.string().min(1).max(200),
  mode: assessmentModeSchema,
  durationMinutes: z.number().nonnegative().nullable(),
  rosterCount: z.number().int().nonnegative(),
  rosterValidation: z.object({
    ok: z.literal(true),
    studentCount: z.number().int().nonnegative(),
    stages: z.array(z.object({
      code: z.string().min(1).max(100),
      count: z.number().int().nonnegative(),
    }).passthrough()),
  }).passthrough(),
  preparationStatus: preparationStatusSchema,
  preparation: preparationSchema.optional(),
});

export const publishAssessmentResponseSchema = z.object({ exam: publishedAssessmentSchema });

export type AuthoringContractMessage = z.infer<typeof authoringContractMessageSchema>;
export type AuthoringFunction = z.infer<typeof authoringFunctionSchema>;
export type AuthoringModeDefinition = z.infer<typeof authoringModeDefinitionSchema>;
export type ExcelAuthoringPreviewBody = z.infer<typeof excelAuthoringPreviewBodySchema>;
export type ManualAuthoringPreviewBody = z.infer<typeof manualAuthoringPreviewBodySchema>;
export type AuthoringPreviewBody = z.infer<typeof authoringPreviewBodySchema>;
export type AuthoringConfigurationBody = z.infer<typeof authoringConfigurationBodySchema>;
export type PublishAssessmentBody = z.infer<typeof publishAssessmentBodySchema>;
export type ComposedAssessmentPlan = z.infer<typeof composedAssessmentPlanSchema>;
type PublicationAuditContract = z.infer<typeof publicationAuditSchema>;
export type PublicationAudit = Pick<
  PublicationAuditContract,
  "ok" | "status" | "version" | "auditedAt" | "blueprints"
>;
export type AuthoringPreviewResponse = z.infer<typeof authoringPreviewResponseSchema>;
export type AuthoringConfiguration = z.infer<typeof authoringConfigurationSchema>;
export type Preparation = z.infer<typeof preparationSchema>;
export type PublishedAssessment = z.infer<typeof publishedAssessmentSchema>;
