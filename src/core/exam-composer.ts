import { FUNCTION_BY_NAME } from "./function-catalog.ts";
import type { FunctionDefinition } from "./function-catalog.ts";
import { getCompatibleCompanions, getCompatibleTriples } from "./function-combination-library.ts";
import {
  ASSIGNMENT_MODE,
  DEFAULT_EXAM_DIFFICULTY,
  EXAM_MODE,
  EXAM_STRUCTURE,
  FORMULA_QUESTIONS_PER_GROUP,
  getExamModeDefinitions,
  resolveExamDifficulty,
  resolveExamModeStructure,
} from "./exam-mode-config.ts";

const SCENARIOS = [
  { key: "staff", name: "Staff records" },
  { key: "attendance", name: "Attendance and score" },
  { key: "sales", name: "Sales and orders" },
  { key: "product", name: "Product and price" },
  { key: "budget", name: "Budget and performance" },
];

const PLAN_SCHEMA_VERSION = 9;
const COMPOSER_VERSION = 12;

export interface ComposerMessage {
  readonly code: string;
  readonly message: string;
  readonly details: Readonly<Record<string, unknown>>;
}

export type ComposeExamPlanResult =
  | { readonly ok: false; readonly errors: ComposerMessage[]; readonly warnings: readonly never[]; readonly plan: null }
  | { readonly ok: true; readonly errors: readonly never[]; readonly warnings: ComposerMessage[]; readonly plan: Readonly<Record<string, any>> };

function normaliseSelection(selectedFunctions: unknown): string[] {
  if (!Array.isArray(selectedFunctions)) return [];
  return [...new Set(selectedFunctions.map((name: unknown) => String(name).trim().toUpperCase()).filter(Boolean))];
}

function buildError(code: string, message: string, details: Readonly<Record<string, unknown>> = {}): ComposerMessage {
  return { code, message, details };
}

function buildWarning(code: string, message: string, details: Readonly<Record<string, unknown>> = {}): ComposerMessage {
  return { code, message, details };
}

function repeatToLength<Item>(functions: readonly Item[], length: number): Item[] {
  return Array.from({ length }, (_, index) => functions[index % functions.length]!);
}

function makeChoiceQuestions(selectedFunctions: readonly FunctionDefinition[], formulaFunctions: readonly FunctionDefinition[], formulaQuestionCount: number, count: number): any[] {
  if (count === 0) return [];

  const choiceOnlyFunctions = selectedFunctions.filter(
    (functionDefinition) => !functionDefinition.modes.includes("formula"),
  );
  const formulaOverflow = formulaFunctions.slice(formulaQuestionCount);
  const priorityFunctions = [
    ...choiceOnlyFunctions,
    ...formulaOverflow,
    ...selectedFunctions.filter(
      (item) => !choiceOnlyFunctions.includes(item) && !formulaOverflow.includes(item),
    ),
  ];

  return repeatToLength(priorityFunctions, count).map((functionDefinition, index) => ({
    id: `choice-${index + 1}`,
    functionName: functionDefinition.name,
    category: functionDefinition.category,
    mode: "choice",
  }));
}

function findCompanions(formulaFunctions: readonly FunctionDefinition[], primary: FunctionDefinition): FunctionDefinition[] {
  const selectedNames = formulaFunctions.map((candidate) => candidate.name);
  const compatible = new Set(getCompatibleCompanions(selectedNames, primary.name));
  return formulaFunctions.filter((candidate) => compatible.has(candidate.name));
}

function findTriples(formulaFunctions: readonly FunctionDefinition[], primary: FunctionDefinition): string[][] {
  return getCompatibleTriples(formulaFunctions.map((candidate) => candidate.name), primary.name);
}

function makeFormulaGroups(
  formulaFunctions: readonly FunctionDefinition[],
  formulaQuestionCount: number,
  combinationPolicy: any,
  { questionsPerFunction = null }: { questionsPerFunction?: number | null } = {},
): any[] {
  const questionFunctions: FunctionDefinition[] = questionsPerFunction !== null && Number.isInteger(questionsPerFunction)
    ? formulaFunctions.flatMap((definition) => Array(questionsPerFunction).fill(definition))
    : repeatToLength(formulaFunctions, formulaQuestionCount);
  const groupCount = Math.ceil(formulaQuestionCount / FORMULA_QUESTIONS_PER_GROUP);
  const doubleTarget = combinationPolicy.doubleQuestionCount;
  const tripleTarget = combinationPolicy.tripleQuestionCount;
  let tripleCount = 0;
  let doubleCount = 0;
  const allocations: any[] = questionFunctions.map((functionDefinition) => {
    const tripleCandidates = tripleCount < tripleTarget ? findTriples(formulaFunctions, functionDefinition) : [];
    if (tripleCandidates.length) tripleCount += 1;
    return { functionDefinition, tripleCandidates, companionCandidates: [] };
  });
  for (const allocation of allocations) {
    if (doubleCount >= doubleTarget) break;
    if (allocation.tripleCandidates.length) continue;
    allocation.companionCandidates = findCompanions(formulaFunctions, allocation.functionDefinition).map((candidate) => candidate.name);
    if (allocation.companionCandidates.length) doubleCount += 1;
  }

  return Array.from({ length: groupCount }, (_, groupIndex) => {
    const start = groupIndex * FORMULA_QUESTIONS_PER_GROUP;
    const groupQuestions = allocations.slice(start, start + FORMULA_QUESTIONS_PER_GROUP);
    return {
      id: `formula-group-${groupIndex + 1}`,
      scenario: SCENARIOS[groupIndex % SCENARIOS.length],
      questions: groupQuestions.map(({ functionDefinition, companionCandidates, tripleCandidates }, questionIndex) => {
        return {
          id: `formula-${groupIndex + 1}-${questionIndex + 1}`,
          functionName: functionDefinition.name,
          companionFunction: null,
          companionCandidates,
          tripleCandidates,
          requiredFunctions: [functionDefinition.name],
          combinationLevel: tripleCandidates.length ? 3 : companionCandidates.length ? 2 : 1,
          difficulty: companionCandidates.length || tripleCandidates.length ? "advanced" : "standard",
          category: functionDefinition.category,
          mode: "formula",
        };
      }),
    };
  });
}

function createCoverage(selectedNames: readonly string[], choiceQuestions: any[], formulaGroups: any[]): any {
  const allFormulaQuestions = formulaGroups.flatMap((group) => group.questions);
  const formulaFunctionUses = allFormulaQuestions.flatMap((question) => question.requiredFunctions ?? [question.functionName]);
  const usedNames = new Set([
    ...choiceQuestions.map((question) => question.functionName),
    ...formulaFunctionUses,
  ]);

  return {
    selected: selectedNames,
    uncovered: selectedNames.filter((name) => !usedNames.has(name)),
    allocations: selectedNames.map((name) => ({
      functionName: name,
      count:
        choiceQuestions.filter((question) => question.functionName === name).length +
        formulaFunctionUses.filter((functionName) => functionName === name).length,
      companionCandidateCount: allFormulaQuestions.filter((question) => question.companionCandidates?.includes(name)).length,
    })),
  };
}

/**
 * Compose a blueprint-level exam or assignment plan from the teacher's selection.
 * Every generated question is limited to a selected function. A small assignment
 * can intentionally cover only a subset of a larger selection and reports that as a warning.
 */
export function composeExamPlan({ mode = EXAM_MODE, difficulty = DEFAULT_EXAM_DIFFICULTY, assignmentOptions, selectedFunctions }: {
  mode?: string;
  difficulty?: string;
  assignmentOptions?: { readonly questionsPerFunction?: number };
  selectedFunctions?: unknown;
} = {}): ComposeExamPlanResult {
  const selectedNames = normaliseSelection(selectedFunctions);
  const errors: ComposerMessage[] = [];
  const selectedFormulaFunctionCount = selectedNames.filter((name) =>
    FUNCTION_BY_NAME.get(name)?.modes.includes("formula")
  ).length;
  const structureResult: any = resolveExamModeStructure({
    mode,
    difficulty,
    ...(assignmentOptions === undefined ? {} : { assignmentOptions }),
    selectedFormulaFunctionCount,
  });
  const structure = structureResult.value ?? null;
  if (!structureResult.ok) errors.push(...structureResult.errors);
  const difficultyResult: any = mode === EXAM_MODE
    ? resolveExamDifficulty(difficulty)
    : { ok: true, value: { key: null, doubleQuestionCount: 0, tripleQuestionCount: 0 } };
  if (!difficultyResult.ok) errors.push(...difficultyResult.errors);

  if (selectedNames.length === 0) {
    errors.push(buildError("NO_FUNCTIONS_SELECTED", "请选择至少一个函数。"));
  }

  const unknownFunctions = selectedNames.filter((name) => !FUNCTION_BY_NAME.has(name));
  if (unknownFunctions.length > 0) {
    errors.push(
      buildError("UNKNOWN_FUNCTION", "包含不在首版函数白名单中的函数。", { functions: unknownFunctions }),
    );
  }

  if (errors.length > 0 || !structure) {
    return { ok: false, errors, warnings: [], plan: null };
  }

  const selectedDefinitions = selectedNames.map((name) => FUNCTION_BY_NAME.get(name)!);
  const formulaFunctions = selectedDefinitions.filter((functionDefinition) =>
    functionDefinition.modes.includes("formula"),
  );

  if (formulaFunctions.length === 0) {
    errors.push(
      buildError(
        "NO_FORMULA_CAPABLE_FUNCTION",
        "当前只勾选了选择题专用函数。请至少勾选一个可用于函数题的函数。",
      ),
    );
  }

  const insufficientBlueprints = selectedDefinitions
    .filter(
      (functionDefinition) =>
        functionDefinition.choiceBlueprintCount < 3 ||
        (functionDefinition.modes.includes("formula") && functionDefinition.formulaBlueprintCount < 3),
    )
    .map((functionDefinition) => functionDefinition.name);

  if (insufficientBlueprints.length > 0) {
    errors.push(
      buildError(
        "INSUFFICIENT_BLUEPRINTS",
        "以下函数缺少规定数量的备用题型蓝图，不能发布考试。",
        { functions: insufficientBlueprints },
      ),
    );
  }

  if (errors.length > 0) {
    return { ok: false, errors, warnings: [], plan: null };
  }

  const choiceQuestions = makeChoiceQuestions(
    selectedDefinitions,
    formulaFunctions,
    structure.formulaQuestionCount,
    structure.choiceQuestionCount,
  );
  const formulaGroups = makeFormulaGroups(
    formulaFunctions,
    structure.formulaQuestionCount,
    difficultyResult.value,
    { questionsPerFunction: structure.mode === ASSIGNMENT_MODE ? structure.questionsPerFunction : null },
  );
  const coverage = createCoverage(selectedNames, choiceQuestions, formulaGroups);
  const formulaQuestions = formulaGroups.flatMap((group) => group.questions);
  const doubleActualCount = formulaQuestions.filter((question) => question.combinationLevel === 2).length;
  const tripleActualCount = formulaQuestions.filter((question) => question.combinationLevel === 3).length;
  const warnings = [
    ...(coverage.uncovered.length ? [
        buildWarning(
          "PARTIAL_COVERAGE",
          "当前题量不足以覆盖所有已勾选函数；未出现的函数不会进入本份试卷。",
          { functions: coverage.uncovered },
        ),
      ] : []),
    ...(
      doubleActualCount < difficultyResult.value.doubleQuestionCount
      || tripleActualCount < difficultyResult.value.tripleQuestionCount
        ? [buildWarning(
            "COMBINATION_TARGET_SHORTFALL",
            "已选函数之间的兼容组合不足，组合题数量低于所选难度目标。",
            {
              doubleTargetCount: difficultyResult.value.doubleQuestionCount,
              doubleActualCount,
              tripleTargetCount: difficultyResult.value.tripleQuestionCount,
              tripleActualCount,
            },
          )]
        : []
    ),
  ];

  return {
    ok: true,
    errors: [],
    warnings,
    plan: {
      // `version` describes the persisted plan shape; `composerVersion`
      // identifies the allocation algorithm that produced that shape.
      version: PLAN_SCHEMA_VERSION,
      composerVersion: COMPOSER_VERSION,
      mode: structure.mode,
      difficulty: difficultyResult.value.key,
      assignmentOptions: structure.mode === ASSIGNMENT_MODE
        ? {
            formulaQuestionCount: structure.formulaQuestionCount,
            choiceQuestionCount: structure.choiceQuestionCount,
            formulaQuestionCountMode: structure.formulaQuestionCountMode,
            questionsPerFunction: structure.questionsPerFunction,
          }
        : null,
      allocationPolicy: structure.mode === ASSIGNMENT_MODE
        ? "selected_functions_grouped_shared"
        : "selected_functions_only_student_seeded",
      selectionPolicy: "selected_functions_only",
      compositePolicy: {
        doubleTargetCount: difficultyResult.value.doubleQuestionCount,
        doubleActualCount,
        tripleTargetCount: difficultyResult.value.tripleQuestionCount,
        tripleActualCount,
        actualCount: doubleActualCount + tripleActualCount,
      },
      questionCounts: {
        choice: structure.choiceQuestionCount,
        formula: structure.formulaQuestionCount,
        formulaGroups: formulaGroups.length,
      },
      choiceQuestions,
      formulaGroups,
      coverage,
    },
  };
}

export { EXAM_STRUCTURE, getExamModeDefinitions };
