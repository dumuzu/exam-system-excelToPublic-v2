/**
 * A small, framework-independent interface for the currently supported
 * composition modes. HTTP handlers and the browser UI may read the public
 * definitions, while the composer uses resolveExamModeStructure() as the
 * single source of validation and defaults.
 */
export const EXAM_MODE = "exam" as const;
export const ASSIGNMENT_MODE = "assignment" as const;
export type ExamMode = typeof EXAM_MODE | typeof ASSIGNMENT_MODE;
export const FORMULA_QUESTIONS_PER_GROUP = 6;
export const ASSIGNMENT_QUESTIONS_PER_FUNCTION = 5;
export const ASSIGNMENT_QUESTIONS_PER_FUNCTION_OPTIONS = Object.freeze([5, 10, 15] as const);
export const DEFAULT_EXAM_DIFFICULTY = "normal" as const;
export const EXAM_ROSTER_LIMITS = Object.freeze({
  [EXAM_MODE]: 200,
  [ASSIGNMENT_MODE]: 500,
});

export const EXAM_DIFFICULTIES = Object.freeze({
  easy: Object.freeze({ choiceQuestionCount: 10, formulaQuestionCount: 30, doubleQuestionCount: 5, tripleQuestionCount: 0 }),
  normal: Object.freeze({ choiceQuestionCount: 0, formulaQuestionCount: 50, doubleQuestionCount: 10, tripleQuestionCount: 0 }),
  hard: Object.freeze({ choiceQuestionCount: 0, formulaQuestionCount: 50, doubleQuestionCount: 20, tripleQuestionCount: 0 }),
  hell: Object.freeze({ choiceQuestionCount: 0, formulaQuestionCount: 50, doubleQuestionCount: 25, tripleQuestionCount: 10 }),
});

const EXAM_STRUCTURE = Object.freeze({
  exam: Object.freeze({
    choiceQuestionCount: 0,
    formulaQuestionCount: 50,
    formulaQuestionsPerGroup: FORMULA_QUESTIONS_PER_GROUP,
  }),
  assignment: Object.freeze({
    defaultQuestionsPerFunction: ASSIGNMENT_QUESTIONS_PER_FUNCTION,
    questionsPerFunctionOptions: ASSIGNMENT_QUESTIONS_PER_FUNCTION_OPTIONS,
    maximumFormulaFunctionCount: 100,
  }),
});

const STUDENT_EXPERIENCE_POLICIES = Object.freeze({
  exam: Object.freeze({
    mode: EXAM_MODE, requiresAdmission: true, requiresFullscreen: true, hasTimeLimit: true,
    proctoringEnabled: true, autosaveEnabled: true, sharedPaper: false,
    randomizeQuestionOrder: true, revealScoreAfterSubmission: false, maximumAttempts: null,
  }),
  assignment: Object.freeze({
    mode: ASSIGNMENT_MODE, requiresAdmission: false, requiresFullscreen: false, hasTimeLimit: false,
    proctoringEnabled: false, autosaveEnabled: false, sharedPaper: true,
    randomizeQuestionOrder: false, revealScoreAfterSubmission: true, maximumAttempts: 2,
  }),
});

export interface ExamConfigurationError {
  readonly code: string;
  readonly message: string;
  readonly details: Readonly<Record<string, unknown>>;
}

function buildError(code: string, message: string, details: Readonly<Record<string, unknown>> = {}): ExamConfigurationError {
  return { code, message, details };
}

/**
 * Returns a copy so a caller cannot mutate the policy used by another caller.
 * Labels deliberately stay out of this module; they belong to the bilingual UI.
 */
export function getExamModeDefinitions() {
  return [
    {
      key: EXAM_MODE,
      configurable: false,
      formulaQuestionCount: EXAM_STRUCTURE.exam.formulaQuestionCount,
      formulaQuestionsPerGroup: EXAM_STRUCTURE.exam.formulaQuestionsPerGroup,
      defaultDifficulty: DEFAULT_EXAM_DIFFICULTY,
      difficulties: Object.entries(EXAM_DIFFICULTIES).map(([key, policy]) => ({ key, ...policy })),
    },
    {
      key: ASSIGNMENT_MODE,
      configurable: true,
      defaultQuestionsPerFunction: EXAM_STRUCTURE.assignment.defaultQuestionsPerFunction,
      questionsPerFunctionOptions: [...EXAM_STRUCTURE.assignment.questionsPerFunctionOptions],
      maximumFormulaFunctionCount: EXAM_STRUCTURE.assignment.maximumFormulaFunctionCount,
      formulaQuestionsPerGroup: FORMULA_QUESTIONS_PER_GROUP,
    },
  ];
}

export function getStudentExperiencePolicy(mode: string = EXAM_MODE) {
  if (mode !== EXAM_MODE && mode !== ASSIGNMENT_MODE) throw new TypeError("UNKNOWN_STUDENT_EXPERIENCE_MODE");
  const policy = STUDENT_EXPERIENCE_POLICIES[mode];
  return { ...policy };
}

export function getRosterLimit(mode: string = EXAM_MODE) {
  if (mode !== EXAM_MODE && mode !== ASSIGNMENT_MODE) throw new TypeError("UNKNOWN_EXAM_ROSTER_MODE");
  const maximumStudents = EXAM_ROSTER_LIMITS[mode];
  return maximumStudents;
}

export function resolveExamDifficulty(difficulty: string = DEFAULT_EXAM_DIFFICULTY) {
  if (!Object.hasOwn(EXAM_DIFFICULTIES, difficulty)) {
    return { ok: false as const, errors: [buildError("UNKNOWN_DIFFICULTY", "试卷难度无效。", { difficulty })] };
  }
  const difficultyKey = difficulty as keyof typeof EXAM_DIFFICULTIES;
  return { ok: true as const, value: { key: difficultyKey, ...EXAM_DIFFICULTIES[difficultyKey] } };
}

/**
 * Resolves defaults and validates the mode-specific question structure.
 * The returned value is intentionally limited to the data the composer needs.
 */
export function resolveExamModeStructure({
  mode = EXAM_MODE,
  difficulty = DEFAULT_EXAM_DIFFICULTY,
  assignmentOptions,
  selectedFormulaFunctionCount = 0,
}: {
  mode?: string;
  difficulty?: string;
  assignmentOptions?: { readonly questionsPerFunction?: number };
  selectedFormulaFunctionCount?: number;
} = {}) {
  if (mode === EXAM_MODE) {
    const difficultyResult = resolveExamDifficulty(difficulty);
    if (!difficultyResult.ok) return difficultyResult;
    const difficultyPolicy = difficultyResult.value;
    return {
      ok: true,
      value: {
        mode: EXAM_MODE,
        choiceQuestionCount: difficultyPolicy.choiceQuestionCount,
        formulaQuestionCount: difficultyPolicy.formulaQuestionCount,
      },
    };
  }

  if (mode !== ASSIGNMENT_MODE) {
    return {
      ok: false,
      errors: [buildError("UNKNOWN_MODE", "出卷模式无效。", { mode })],
    };
  }

  const questionsPerFunction = assignmentOptions?.questionsPerFunction
    ?? EXAM_STRUCTURE.assignment.defaultQuestionsPerFunction;
  const formulaQuestionCount = selectedFormulaFunctionCount * questionsPerFunction;
  const errors: ExamConfigurationError[] = [];

  if (!(EXAM_STRUCTURE.assignment.questionsPerFunctionOptions as readonly number[]).includes(questionsPerFunction)) {
    errors.push(
      buildError(
        "INVALID_ASSIGNMENT_QUESTION_COUNT",
        "课题模式中每个函数的题量只能选择 5、10 或 15。",
        { questionsPerFunction },
      ),
    );
  }

  if (!Number.isInteger(selectedFormulaFunctionCount)
    || selectedFormulaFunctionCount < 1
    || selectedFormulaFunctionCount > EXAM_STRUCTURE.assignment.maximumFormulaFunctionCount) {
    errors.push(
      buildError(
        "INVALID_ASSIGNMENT_FORMULA_COUNT",
        `课题模式需要选择 1～${EXAM_STRUCTURE.assignment.maximumFormulaFunctionCount} 个可用于函数题的函数。`,
      ),
    );
  }

  return errors.length > 0
    ? { ok: false, errors }
    : {
        ok: true,
        value: {
          mode: ASSIGNMENT_MODE,
          choiceQuestionCount: 0,
          formulaQuestionCount,
          formulaQuestionCountMode: "per_function",
          questionsPerFunction,
        },
      };
}

export { EXAM_STRUCTURE };
