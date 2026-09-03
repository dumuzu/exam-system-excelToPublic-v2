import type { Result } from "../../platform/assessment-contracts.ts";
import { BROWSER_THREE_STRIKE_POLICY_ID } from "../../core/integrity-policy.ts";
import type {
  AssessmentTypeAdapter,
  AssessmentWorkspaceCapabilities,
} from "../../core/assessment-kernel.ts";
import { composeExamPlan } from "../../core/exam-composer.ts";
import { getStudentExperiencePolicy } from "../../core/exam-mode-config.ts";
import { gradeSubmission } from "../../core/formula-grader.ts";
import {
  flattenPlanQuestions,
  generateQuestionInstance,
  orderQuestionInstances,
  validatePreparedPaper,
} from "../../core/paper-question-factory.ts";

type AssessmentMode = "exam" | "assignment";

interface ExcelPlan {
  readonly mode: AssessmentMode;
  readonly questionCounts: Readonly<{ choice: number; formula: number }>;
  readonly choiceQuestions: readonly unknown[];
  readonly formulaGroups: readonly Readonly<{ questions: readonly unknown[] }>[];
  readonly coverage: Readonly<{ selected: readonly string[] }>;
  readonly [key: string]: unknown;
}

export interface ExcelAssessmentConfiguration {
  readonly plan: ExcelPlan;
  readonly warnings: readonly Readonly<Record<string, unknown>>[];
}

export interface ExcelPreparedQuestion {
  readonly key: string;
  readonly questionMode: "choice" | "formula";
  readonly functionName: string;
  readonly blueprintKey: string;
  readonly studentPayload: Readonly<Record<string, unknown>>;
  readonly answerKey: Readonly<Record<string, unknown>>;
  readonly scoringRule: Readonly<Record<string, unknown>>;
}

export interface ExcelPreparedPaper {
  readonly questions: readonly ExcelPreparedQuestion[];
}

export interface ExcelStudentQuestion {
  readonly key: string;
  readonly questionMode: "choice" | "formula";
  readonly [key: string]: unknown;
}

export interface ExcelStudentView {
  readonly questions: readonly ExcelStudentQuestion[];
}

export type ExcelResponse = Readonly<Record<string, string>>;
export type ExcelGrade = Readonly<Record<string, unknown>>;

export function gradeExcelResponse({
  questions,
  answers,
  policyViolation = false,
}: {
  questions: readonly ExcelPreparedQuestion[];
  answers: ExcelResponse;
  policyViolation?: boolean;
}): ExcelGrade {
  return gradeSubmission({ questions, answers, policyViolation }) as ExcelGrade;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function error(code: string, message: string, details?: Readonly<Record<string, unknown>>): Result<never> {
  return details === undefined
    ? { ok: false, errors: [{ code, message }] }
    : { ok: false, errors: [{ code, message, details }] };
}

function normalizeComposerErrors(errors: unknown): readonly Readonly<Record<string, unknown>>[] {
  if (!Array.isArray(errors)) return [{ code: "INVALID_EXCEL_CONFIGURATION", message: "Excel assessment configuration is invalid." }];
  return errors.map((candidate) => isRecord(candidate)
    ? candidate
    : { code: "INVALID_EXCEL_CONFIGURATION", message: "Excel assessment configuration is invalid." });
}

function getWorkspace(mode: AssessmentMode): AssessmentWorkspaceCapabilities {
  const policy = getStudentExperiencePolicy(mode) as Omit<AssessmentWorkspaceCapabilities, "responseKind" | "automaticGrading">;
  return {
    ...policy,
    responseKind: "excel_formula_map",
    automaticGrading: true,
  };
}

const adapter: AssessmentTypeAdapter<
  ExcelAssessmentConfiguration,
  ExcelPreparedPaper,
  ExcelStudentView,
  ExcelResponse,
  ExcelGrade
> = {
  descriptor: Object.freeze({
    key: "excel_formula",
    version: 1,
    supportedModes: Object.freeze(["exam", "assignment"] as const),
    compatibleIntegrityPolicyIds: Object.freeze([BROWSER_THREE_STRIKE_POLICY_ID]),
  }),

  getStudentWorkspaceCapabilities(mode) {
    return getWorkspace(mode);
  },

  validateAuthoring({ mode, input }) {
    if (!isRecord(input)) return error("INVALID_EXCEL_CONFIGURATION", "Excel assessment configuration must be an object.");
    const composition = composeExamPlan({ ...input, mode } as any) as {
      ok: boolean;
      errors: unknown;
      warnings: unknown;
      plan: unknown;
    };
    if (!composition.ok || !isRecord(composition.plan)) {
      return { ok: false, errors: normalizeComposerErrors(composition.errors).map((candidate) => ({
        code: typeof candidate["code"] === "string" ? candidate["code"] : "INVALID_EXCEL_CONFIGURATION",
        message: typeof candidate["message"] === "string" ? candidate["message"] : "Excel assessment configuration is invalid.",
        ...(isRecord(candidate["details"]) ? { details: candidate["details"] } : {}),
      })) };
    }
    const plan = composition.plan as unknown as ExcelPlan;
    if (plan.mode !== mode) return error("EXCEL_MODE_MISMATCH", "The Excel plan mode does not match the assessment event mode.");
    const warnings = Array.isArray(composition.warnings)
      ? composition.warnings.filter(isRecord)
      : [];
    return { ok: true, value: { plan: structuredClone(plan), warnings: structuredClone(warnings) } };
  },

  async preparePaper({ eventId, mode, scope, configuration }) {
    if (configuration.plan.mode !== mode) return error("EXCEL_MODE_MISMATCH", "The Excel plan mode does not match the assessment event mode.");
    if (mode === "exam" && scope.kind !== "participant") {
      return error("INVALID_PREPARATION_SCOPE", "A formal Excel exam requires a participant-scoped paper.");
    }
    if (mode === "assignment" && scope.kind !== "shared") {
      return error("INVALID_PREPARATION_SCOPE", "An Excel classroom assignment requires one shared paper.");
    }

    const participantKey = scope.kind === "participant" ? scope.participantKey : "SHARED-ASSIGNMENT";
    try {
      const planQuestions = flattenPlanQuestions(configuration.plan) as unknown[];
      const generated = planQuestions.map((question) => generateQuestionInstance({
        examCode: eventId,
        studentNumber: participantKey,
        question,
      })) as ExcelPreparedQuestion[];
      const questions = mode === "exam"
        ? orderQuestionInstances(generated, { examCode: eventId, studentNumber: participantKey }) as ExcelPreparedQuestion[]
        : generated;
      const validation = validatePreparedPaper(questions, configuration.plan) as { ok: boolean; errors: unknown };
      if (!validation.ok) {
        return error("INVALID_PREPARED_EXCEL_PAPER", "The prepared Excel paper failed structural validation.", {
          errors: Array.isArray(validation.errors) ? validation.errors : [],
        });
      }
      return { ok: true, value: { questions: structuredClone(questions) } };
    } catch {
      return error("EXCEL_PAPER_PREPARATION_FAILED", "The Excel paper could not be prepared.");
    }
  },

  createStudentView({ paper }) {
    return {
      questions: paper.questions.map((question) => ({
        key: question.key,
        questionMode: question.questionMode,
        ...structuredClone(question.studentPayload),
      })),
    };
  },

  validateResponse({ paper, input }) {
    if (!isRecord(input)) return error("INVALID_EXCEL_RESPONSE", "Excel responses must be a question-to-answer object.");
    const allowedQuestionKeys = new Set(paper.questions.map((question) => question.key));
    const response: Record<string, string> = {};
    for (const [questionKey, answer] of Object.entries(input)) {
      if (!allowedQuestionKeys.has(questionKey) || typeof answer !== "string" || answer.length > 10_000) {
        return error("INVALID_EXCEL_RESPONSE", "Excel responses contain an unknown question or invalid answer.");
      }
      response[questionKey] = answer;
    }
    return { ok: true, value: response };
  },

  gradeResponse({ paper, response }) {
    return gradeExcelResponse({ questions: paper.questions, answers: response });
  },
};

export const excelAssessmentAdapter = Object.freeze(adapter);
