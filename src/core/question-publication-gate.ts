import { createHash } from "node:crypto";

import { gradeQuestionAnswer } from "./formula-grader.ts";
import { listBusinessScenarioKeys } from "./business-scenario-library.ts";
import {
  flattenPlanQuestions,
  generateQuestionInstance,
  orderQuestionInstances,
  validatePreparedPaper,
} from "./paper-question-factory.ts";
import type { PreparedQuestion } from "./paper-question-factory.ts";

const PUBLICATION_AUDIT_VERSION = "publication-gate-v3";
const SAMPLE_STUDENTS = Object.freeze(["AUDIT001", "AUDIT002"]);
const MAX_REPORTED_ERRORS = 100;
const BUSINESS_SCENARIO_KEYS = Object.freeze(listBusinessScenarioKeys());

type DynamicRecord = any;

export interface PublicationAuditResult {
  readonly ok: boolean;
  readonly status: "approved" | "blocked";
  readonly version: string;
  readonly auditedAt: string;
  readonly errors: DynamicRecord[];
  readonly warnings: unknown[];
  readonly summary: Readonly<Record<string, number>>;
  readonly blueprints: DynamicRecord[];
}

function contentHash(instance: DynamicRecord): string {
  return createHash("sha256").update(JSON.stringify({
    blueprintKey: instance.blueprintKey,
    questionMode: instance.questionMode,
    scoringVersion: instance.scoringRule?.version,
    requiredFunctions: instance.scoringRule?.requiredFunctions ?? [],
    generatorVersion: "business-v4-bilingual",
  })).digest("hex");
}

function blueprintVariants(question: DynamicRecord): DynamicRecord[] {
  if (question.mode !== "formula") return [question];
  if (Array.isArray(question.tripleCandidates) && question.tripleCandidates.length) {
    return question.tripleCandidates.map((candidate: unknown) => ({
      ...question,
      companionCandidates: [],
      tripleCandidates: [candidate],
    }));
  }
  if (Array.isArray(question.companionCandidates) && question.companionCandidates.length) {
    return question.companionCandidates.map((candidate: unknown) => ({
      ...question,
      companionCandidates: [candidate],
      tripleCandidates: [],
    }));
  }
  return [question];
}

function answerForReplay(instance: DynamicRecord): unknown {
  return instance.questionMode === "choice"
    ? instance.answerKey?.correctOption
    : instance.answerKey?.allowedFormula;
}

function validateInstance(instance: DynamicRecord, errors: DynamicRecord[], context: DynamicRecord): void {
  const prompt = instance.studentPayload?.promptJa;
  const promptEn = instance.studentPayload?.promptEn;
  if (typeof prompt !== "string" || prompt.trim().length < 5 || typeof promptEn !== "string" || promptEn.trim().length < 5) {
    errors.push({ code: "BLUEPRINT_PROMPT_INVALID", context });
    return;
  }
  if (/described in the Japanese instruction/i.test(promptEn)) {
    errors.push({ code: "BLUEPRINT_ENGLISH_PROMPT_FALLBACK", context });
    return;
  }
  const grade = gradeQuestionAnswer({ question: instance, answer: answerForReplay(instance) });
  if (grade.status !== "correct" || grade.awardedScore !== grade.maximumScore) {
    errors.push({ code: "BLUEPRINT_REPLAY_FAILED", context, blueprintKey: instance.blueprintKey });
  }
}

function generateScenarioReplays(question: DynamicRecord, context: DynamicRecord): PreparedQuestion[] {
  if (question.mode === "choice") {
    return [generateQuestionInstance({ examCode: "PUBLICATION-AUDIT", studentNumber: `CHOICE-${context.questionIndex}`, question })];
  }
  const byScenario = new Map<string, PreparedQuestion>();
  for (let seed = 0; seed < 200 && byScenario.size < BUSINESS_SCENARIO_KEYS.length; seed += 1) {
    const instance = generateQuestionInstance({
      examCode: "PUBLICATION-AUDIT",
      studentNumber: `VARIANT-${context.questionIndex}-${context.variantIndex}-${seed}`,
      question,
    });
    byScenario.set(instance.studentPayload?.scenario?.key, instance);
  }
  const missingScenarios = BUSINESS_SCENARIO_KEYS.filter((key) => !byScenario.has(key));
  if (missingScenarios.length) throw new Error(`Missing scenario replay: ${missingScenarios.join(",")}`);
  return BUSINESS_SCENARIO_KEYS.map((key) => byScenario.get(key)!);
}

export function auditExamPublication({ plan, warnings = [], now = new Date() }: {
  plan?: DynamicRecord;
  warnings?: unknown;
  now?: Date;
} = {}): PublicationAuditResult {
  const errors: DynamicRecord[] = [];
  const blueprints = new Map<string, DynamicRecord>();
  const planQuestions = plan ? flattenPlanQuestions(plan) : [];
  const selectedFunctions = new Set(plan?.coverage?.selected ?? []);
  const addError = (error: DynamicRecord): void => { if (errors.length < MAX_REPORTED_ERRORS) errors.push(error); };

  if (!plan || !Array.isArray(plan.formulaGroups) || !Array.isArray(plan.choiceQuestions)) {
    addError({ code: "PLAN_STRUCTURE_INVALID" });
  }
  const validFormalStructure = plan?.difficulty === "easy"
    ? Number(plan.questionCounts?.formula) === 30
      && Number(plan.questionCounts?.choice) === 10
      && plan.choiceQuestions.length === 10
    : Number(plan?.questionCounts?.formula) === 50
      && Number(plan?.questionCounts?.choice) === 0
      && plan?.choiceQuestions?.length === 0;
  if (plan?.mode === "exam" && !validFormalStructure) {
    addError({ code: "FORMAL_EXAM_STRUCTURE_INVALID" });
  }
  if (!selectedFunctions.size) addError({ code: "FUNCTION_COVERAGE_EMPTY" });

  let replayedVariantCount = 0;
  for (const [questionIndex, question] of planQuestions.entries()) {
    for (const [variantIndex, variant] of blueprintVariants(question).entries()) {
      try {
        const instances = generateScenarioReplays(variant, { questionIndex, variantIndex });
        for (const [scenarioIndex, instance] of instances.entries()) {
          validateInstance(instance, errors, { questionIndex, variantIndex, scenarioIndex });
          replayedVariantCount += 1;
          const requiredFunctions = instance.scoringRule?.requiredFunctions ?? [];
          if (requiredFunctions.some((name: unknown) => !selectedFunctions.has(name))) {
            addError({ code: "BLUEPRINT_FUNCTION_SCOPE_INVALID", blueprintKey: instance.blueprintKey });
          }
          blueprints.set(instance.blueprintKey, {
            key: instance.blueprintKey,
            questionMode: instance.questionMode,
            reviewStatus: "approved",
            scoringVersion: instance.scoringRule?.version ?? null,
            requiredFunctions,
            contentHash: contentHash(instance),
          });
        }
      } catch (error) {
        addError({ code: "BLUEPRINT_GENERATION_FAILED", context: { questionIndex, variantIndex }, reason: error instanceof Error ? error.message : "unknown" });
      }
    }
  }

  let samplePaperCount = 0;
  if (plan && errors.length < MAX_REPORTED_ERRORS) {
    for (const studentNumber of SAMPLE_STUDENTS) {
      try {
        const instances = orderQuestionInstances(
          planQuestions.map((question) => generateQuestionInstance({ examCode: "PUBLICATION-AUDIT", studentNumber, question })),
          { examCode: "PUBLICATION-AUDIT", studentNumber },
        );
        const validation = validatePreparedPaper(instances, plan);
        if (!validation.ok) validation.errors.forEach((error: DynamicRecord) => addError({ code: "SAMPLE_PAPER_INVALID", studentNumber, detail: error }));
        instances.forEach((instance, index) => validateInstance(instance, errors, { studentNumber, index }));
        samplePaperCount += 1;
      } catch (error) {
        addError({ code: "SAMPLE_PAPER_GENERATION_FAILED", studentNumber, reason: error instanceof Error ? error.message : "unknown" });
      }
    }
  }

  const approved = errors.length === 0;
  return {
    ok: approved,
    status: approved ? "approved" : "blocked",
    version: PUBLICATION_AUDIT_VERSION,
    auditedAt: now.toISOString(),
    errors,
    warnings: Array.isArray(warnings) ? structuredClone(warnings) : [],
    summary: {
      formulaQuestionCount: Number(plan?.questionCounts?.formula ?? 0),
      choiceQuestionCount: Number(plan?.questionCounts?.choice ?? 0),
      selectedFunctionCount: selectedFunctions.size,
      samplePaperCount,
      replayedVariantCount,
      approvedBlueprintCount: blueprints.size,
    },
    blueprints: [...blueprints.values()],
  };
}

export { PUBLICATION_AUDIT_VERSION };
