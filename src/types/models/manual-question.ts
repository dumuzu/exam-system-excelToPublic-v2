import { z } from "zod";

export const MANUAL_QUESTION_TYPES = Object.freeze([
  "single_choice",
  "multiple_choice",
  "fill_blank",
  "short_answer",
] as const);

export const manualQuestionTypeSchema = z.enum(MANUAL_QUESTION_TYPES);

export const MANUAL_PAPER_STRATEGIES = Object.freeze(["all_questions", "random_subset"] as const);
export const manualPaperStrategySchema = z.enum(MANUAL_PAPER_STRATEGIES);
export const manualPaperRuleSchema = z.discriminatedUnion("strategy", [
  z.object({ strategy: z.literal("all_questions") }).strict(),
  z.object({
    strategy: z.literal("random_subset"),
    questionCount: z.number().int().positive(),
  }).strict(),
]);

const manualIdentifierSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/);
const manualMarkdownSchema = z.string().max(20_000).refine((value) => !value.includes("\0"));
const nonEmptyManualMarkdownSchema = manualMarkdownSchema.refine((value) => value.trim().length > 0);

export const manualPromptImageSchema = z.object({
  dataUrl: z.string().regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/),
  alt: z.string().max(300).refine((value) => !value.includes("\0")),
}).strict();

export const manualChoiceOptionSchema = z.object({
  id: manualIdentifierSchema,
  markdown: z.string().min(1).max(5_000).refine((value) => !value.includes("\0") && value.trim().length > 0),
}).strict();

export const manualTextSegmentSchema = z.object({
  kind: z.literal("text"),
  markdown: nonEmptyManualMarkdownSchema,
}).strict();

export const manualBlankSegmentSchema = z.object({
  kind: z.literal("blank"),
  id: manualIdentifierSchema,
  acceptedAnswers: z.array(z.string().min(1).max(500)).min(1).max(10).optional(),
}).strict();

const manualQuestionBaseShape = {
  key: manualIdentifierSchema,
  promptMarkdown: manualMarkdownSchema,
  image: manualPromptImageSchema.optional(),
};

function validateChoiceQuestion(
  value: { options: readonly { id: string }[]; correctOptionIds?: readonly string[] | undefined },
  context: z.RefinementCtx,
  multiple: boolean,
): void {
  const optionIds = value.options.map((option) => option.id);
  if (new Set(optionIds).size !== optionIds.length) {
    context.addIssue({ code: "custom", message: "Choice option identifiers must be unique.", path: ["options"] });
  }
  const correctIds = value.correctOptionIds;
  if (!correctIds) return;
  if (new Set(correctIds).size !== correctIds.length || correctIds.some((id) => !optionIds.includes(id))) {
    context.addIssue({ code: "custom", message: "Correct answers must reference unique options.", path: ["correctOptionIds"] });
  }
  if (!multiple && correctIds.length !== 1) {
    context.addIssue({ code: "custom", message: "A single-choice question must have one preset answer.", path: ["correctOptionIds"] });
  }
}

export const manualSingleChoiceQuestionSchema = z.object({
  ...manualQuestionBaseShape,
  type: z.literal("single_choice"),
  promptMarkdown: nonEmptyManualMarkdownSchema,
  options: z.array(manualChoiceOptionSchema).min(2).max(20),
  correctOptionIds: z.array(manualIdentifierSchema).min(1).optional(),
}).strict().superRefine((value, context) => validateChoiceQuestion(value, context, false));

export const manualMultipleChoiceQuestionSchema = z.object({
  ...manualQuestionBaseShape,
  type: z.literal("multiple_choice"),
  promptMarkdown: nonEmptyManualMarkdownSchema,
  options: z.array(manualChoiceOptionSchema).min(2).max(20),
  correctOptionIds: z.array(manualIdentifierSchema).min(1).optional(),
}).strict().superRefine((value, context) => validateChoiceQuestion(value, context, true));

export const manualFillBlankQuestionSchema = z.object({
  ...manualQuestionBaseShape,
  type: z.literal("fill_blank"),
  segments: z.array(z.discriminatedUnion("kind", [manualTextSegmentSchema, manualBlankSegmentSchema])).min(1),
}).strict().superRefine((value, context) => {
  const blankIds = value.segments.filter((segment) => segment.kind === "blank").map((segment) => segment.id);
  if (blankIds.length === 0) {
    context.addIssue({ code: "custom", message: "A fill-blank question requires at least one blank.", path: ["segments"] });
  }
  if (new Set(blankIds).size !== blankIds.length) {
    context.addIssue({ code: "custom", message: "Blank identifiers must be unique.", path: ["segments"] });
  }
});

export const manualShortAnswerQuestionSchema = z.object({
  ...manualQuestionBaseShape,
  type: z.literal("short_answer"),
  promptMarkdown: nonEmptyManualMarkdownSchema,
  referenceAnswerMarkdown: nonEmptyManualMarkdownSchema.optional(),
}).strict();

export const manualQuestionSchema = z.union([
  manualSingleChoiceQuestionSchema,
  manualMultipleChoiceQuestionSchema,
  manualFillBlankQuestionSchema,
  manualShortAnswerQuestionSchema,
]);

export type ManualQuestionType = z.infer<typeof manualQuestionTypeSchema>;
export type ManualPaperStrategy = z.infer<typeof manualPaperStrategySchema>;
export type ManualPaperRule = z.infer<typeof manualPaperRuleSchema>;
export type ManualPromptImage = z.infer<typeof manualPromptImageSchema>;
export type ManualChoiceOption = z.infer<typeof manualChoiceOptionSchema>;
export type ManualTextSegment = z.infer<typeof manualTextSegmentSchema>;
export type ManualBlankSegment = z.infer<typeof manualBlankSegmentSchema>;
export type ManualSingleChoiceQuestion = z.infer<typeof manualSingleChoiceQuestionSchema>;
export type ManualMultipleChoiceQuestion = z.infer<typeof manualMultipleChoiceQuestionSchema>;
export type ManualFillBlankQuestion = z.infer<typeof manualFillBlankQuestionSchema>;
export type ManualShortAnswerQuestion = z.infer<typeof manualShortAnswerQuestionSchema>;
export type ManualQuestion = z.infer<typeof manualQuestionSchema>;
