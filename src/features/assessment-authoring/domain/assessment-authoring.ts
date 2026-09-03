import { createHash } from "node:crypto";

import { excelAssessmentAdapter } from "../../../assessment-types/excel/index.ts";
import { MANUAL_ASSESSMENT_TYPE_KEY, manualAssessmentAdapter } from "../../../assessment-types/manual/index.ts";
import { getExamModeDefinitions } from "../../../core/exam-mode-config.ts";
import { FUNCTION_CATALOG } from "../../../core/function-catalog.ts";
import { auditExamPublication } from "../../../core/question-publication-gate.ts";
import type { ContractError } from "../../../platform/assessment-contracts.ts";
import {
  manualAuthoringPreviewBodySchema,
  type ComposedAssessmentPlan,
  type PublicationAudit as AssessmentPublicationAudit,
} from "../../../types/contracts/exam-authoring.ts";

const maxConfigurationNameLength = 100;

export interface AssessmentSubject {
  readonly assessmentTypeKey: string;
}

export interface ValidAssessmentPlanInput {
  readonly valid: true;
  readonly mode: string;
  readonly durationMinutes: number | null;
  readonly difficulty: string;
  readonly assignmentOptions: Readonly<Record<string, unknown>>;
  readonly selectedFunctions: readonly string[];
}

export interface InvalidAssessmentInput {
  readonly valid: false;
  readonly code: string;
  readonly error: string;
}

export type AssessmentPlanInput = ValidAssessmentPlanInput | InvalidAssessmentInput;
export type AssessmentConfigurationInput = (ValidAssessmentPlanInput & { readonly name: string }) | InvalidAssessmentInput;

export type SubjectAssessmentComposition =
  | Readonly<{
    ok: true;
    errors: readonly ContractError[];
    warnings: readonly unknown[];
    plan: ComposedAssessmentPlan;
    publicationAudit: AssessmentPublicationAudit;
  }>
  | Readonly<{
    ok: false;
    errors: readonly ContractError[];
    warnings: readonly unknown[];
    plan: null;
    publicationAudit: AssessmentPublicationAudit | null;
  }>;

type UnpublishedAssessmentComposition =
  | Readonly<{
    ok: true;
    errors: readonly ContractError[];
    warnings: readonly unknown[];
    plan: ComposedAssessmentPlan;
  }>
  | Readonly<{
    ok: false;
    errors: readonly ContractError[];
    warnings: readonly unknown[];
    plan: null;
  }>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function validatePlanPayload(body: unknown): AssessmentPlanInput {
  const record = isRecord(body) ? body : {};
  const selectedFunctions = Array.isArray(record["selectedFunctions"]) ? record["selectedFunctions"] : null;
  const mode = typeof record["mode"] === "string" ? record["mode"] : "exam";
  const difficulty = typeof record["difficulty"] === "string" ? record["difficulty"] : "normal";
  const assignmentOptions = isRecord(record["assignmentOptions"]) ? record["assignmentOptions"] : {};
  const duration = validateAssessmentDuration(record, mode);

  if (!selectedFunctions || selectedFunctions.length === 0 || selectedFunctions.length > FUNCTION_CATALOG.length) {
    return { valid: false, code: "NO_FUNCTIONS_SELECTED", error: "请至少勾选一个函数。" };
  }
  if (!selectedFunctions.every((name): name is string => typeof name === "string" && name.length <= 32)) {
    return { valid: false, code: "INVALID_FUNCTION_SELECTION", error: "函数选择格式无效。" };
  }
  if (!duration.valid) return duration;

  return { valid: true, mode, durationMinutes: duration.durationMinutes, difficulty, assignmentOptions, selectedFunctions };
}

export function validateAssessmentDuration(body: unknown, mode = "exam"):
  | { readonly valid: true; readonly durationMinutes: number | null }
  | InvalidAssessmentInput {
  if (mode === "assignment") return { valid: true, durationMinutes: null };
  const record = isRecord(body) ? body : {};
  const candidate = record["durationMinutes"] ?? 90;
  if (!Number.isInteger(candidate) || Number(candidate) < 1 || Number(candidate) > 240) {
    return { valid: false, code: "INVALID_EXAM_DURATION", error: "考试时长必须为 1 至 240 分钟的整数。" };
  }
  return { valid: true, durationMinutes: Number(candidate) };
}

export function validateConfigurationPayload(body: unknown): AssessmentConfigurationInput {
  const name = validateConfigurationName(body);
  const planPayload = validatePlanPayload(body);
  if (!name) {
    return { valid: false, code: "INVALID_CONFIGURATION_NAME", error: "请输入 1 至 100 个字符的配置名称。" };
  }
  if (!planPayload.valid) return planPayload;
  return { ...planPayload, name };
}

function composeExcelAssessment(configuration: unknown): UnpublishedAssessmentComposition {
  const record = isRecord(configuration) ? configuration : {};
  const result = excelAssessmentAdapter.validateAuthoring({
    mode: typeof record["mode"] === "string" ? record["mode"] as "exam" | "assignment" : "exam",
    input: record,
  });
  return result.ok
    ? {
      ok: true,
      errors: [],
      warnings: result.value.warnings,
      plan: result.value.plan as unknown as ComposedAssessmentPlan,
    }
    : { ok: false, errors: result.errors, warnings: [], plan: null };
}

function composeManualAssessment(configuration: unknown): SubjectAssessmentComposition {
  const record = isRecord(configuration) ? configuration : {};
  const parsed = manualAuthoringPreviewBodySchema.safeParse({
    mode: "exam",
    questions: record["questions"],
    ...(record["paperRule"] === undefined ? {} : { paperRule: record["paperRule"] }),
  });
  if (!parsed.success) {
    const invalidPaperRule = parsed.error.issues.some((issue) => issue.path[0] === "paperRule");
    return {
      ok: false,
      errors: [{
        code: invalidPaperRule ? "INVALID_MANUAL_PAPER_RULE" : "INVALID_MANUAL_QUESTION",
        message: invalidPaperRule
          ? "The paper question count must be a positive integer within the question bank size."
          : "A teacher-authored question is invalid.",
      }],
      warnings: [],
      plan: null,
      publicationAudit: null,
    };
  }
  const result = manualAssessmentAdapter.validateAuthoring({
    mode: "exam",
    input: parsed.data,
  });
  if (!result.ok) return { ok: false, errors: result.errors, warnings: [], plan: null, publicationAudit: null };
  const questions = [...result.value.questions];
  const paperRule = result.value.paperRule;
  const publishedQuestionCount = paperRule.strategy === "random_subset"
    ? paperRule.questionCount
    : questions.length;
  const auditedAt = new Date().toISOString();
  // 手动作答卷也绑定内容哈希，确保发布记录能识别题目被修改。
  const auditedQuestions = questions.map((question) => {
    const contentHash = createHash("sha256").update(JSON.stringify(question)).digest("hex");
    return { question, contentHash, blueprintKey: `manual-${contentHash.slice(0, 40)}` };
  });
  const plan = {
    mode: "exam",
    difficulty: "teacher_authored",
    composerVersion: 2,
    assessmentTypeKey: MANUAL_ASSESSMENT_TYPE_KEY,
    questionCounts: {
      choice: 0,
      formula: publishedQuestionCount,
      formulaGroups: Math.ceil(publishedQuestionCount / 6),
    },
    manualPaperRule: paperRule,
    questionBankSize: questions.length,
    manualQuestionCounts: Object.fromEntries(
      ["single_choice", "multiple_choice", "fill_blank", "short_answer"].map((type) => [
        type,
        questions.filter((question) => question.type === type).length,
      ]),
    ),
    coverage: { selected: [] },
    questions,
    blueprintKeysByQuestion: Object.fromEntries(auditedQuestions.map(({ question, blueprintKey }) => [question.key, blueprintKey])),
  } satisfies ComposedAssessmentPlan;
  const publicationAudit = {
    ok: true,
    status: "approved",
    version: "manual-authoring-v2",
    auditedAt,
    blueprints: auditedQuestions.map(({ blueprintKey, contentHash }) => ({
      key: blueprintKey,
      reviewStatus: "approved",
      contentHash,
    })),
  } satisfies AssessmentPublicationAudit;
  return { ok: true, errors: [], warnings: [], plan, publicationAudit };
}

export function composeSubjectAssessment(
  subject: AssessmentSubject,
  configuration: unknown,
  publicationGate: typeof auditExamPublication = auditExamPublication,
): SubjectAssessmentComposition {
  if (subject.assessmentTypeKey === excelAssessmentAdapter.descriptor.key) {
    const composition = composeExcelAssessment(configuration);
    if (!composition.ok) return { ...composition, publicationAudit: null };
    const publicationAudit = publicationGate({ plan: composition.plan, warnings: composition.warnings });
    return { ...composition, publicationAudit };
  }
  if (subject.assessmentTypeKey === MANUAL_ASSESSMENT_TYPE_KEY) return composeManualAssessment(configuration);
  return {
    ok: false,
    errors: [{ code: "ASSESSMENT_TYPE_UNSUPPORTED", message: "The selected subject uses an unsupported assessment type." }],
    warnings: [],
    plan: null,
    publicationAudit: null,
  };
}

export function supportsSubjectAssessment(subject: AssessmentSubject): boolean {
  return supportsAssessmentTypeKey(subject.assessmentTypeKey);
}

export function supportsAssessmentTypeKey(assessmentTypeKey: string): boolean {
  return assessmentTypeKey === excelAssessmentAdapter.descriptor.key
    || assessmentTypeKey === MANUAL_ASSESSMENT_TYPE_KEY;
}

export function validateConfigurationName(body: unknown): string | null {
  if (!isRecord(body)) return null;
  const name = typeof body["name"] === "string" ? body["name"].trim() : "";
  return name && name.length <= maxConfigurationNameLength ? name : null;
}

export function getAssessmentModeDefinitions(subject: AssessmentSubject) {
  return subject.assessmentTypeKey === MANUAL_ASSESSMENT_TYPE_KEY
    ? [{ key: "exam", configurable: true, authoringKind: MANUAL_ASSESSMENT_TYPE_KEY }]
    : getExamModeDefinitions();
}

export function usesManualAuthoring(subject: AssessmentSubject): boolean {
  return subject.assessmentTypeKey === MANUAL_ASSESSMENT_TYPE_KEY;
}

export function usesExcelAuthoring(subject: AssessmentSubject): boolean {
  return subject.assessmentTypeKey === excelAssessmentAdapter.descriptor.key;
}
