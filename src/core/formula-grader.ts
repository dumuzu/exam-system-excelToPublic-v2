import { Decimal } from "decimal.js";
import { evaluateExcelFormula } from "./safe-formula-engine.ts";

type DynamicRecord = any;

export interface QuestionGrade {
  readonly awardedScore: number;
  readonly maximumScore: number;
  readonly status: "correct" | "partial_core_function_missing" | "incorrect";
  readonly calculatedValue: unknown;
}

function finiteScore(value: unknown, fallback = 0): number {
  const score = Number(value);
  return Number.isFinite(score) && score >= 0 ? score : fallback;
}

function expectedFunctions(scoringRule: DynamicRecord): string[] {
  const source: unknown[] = Array.isArray(scoringRule.requiredFunctions)
    ? scoringRule.requiredFunctions
    : scoringRule.requiredFunction ? [scoringRule.requiredFunction] : [];
  return [...new Set(source.map((name: unknown) => String(name).trim().toUpperCase()).filter(Boolean))];
}

function acceptableFunctionSets(scoringRule: DynamicRecord): string[][] {
  const configured = Array.isArray(scoringRule.acceptedFunctionSets) ? scoringRule.acceptedFunctionSets : [];
  const sets = configured
    .filter(Array.isArray)
    .map((names: unknown[]) => [...new Set(names.map((name: unknown) => String(name).trim().toUpperCase()).filter(Boolean))])
    .filter((names: string[]) => names.length);
  const required = expectedFunctions(scoringRule);
  if (required.length) sets.unshift(required);
  return sets;
}

function normaliseText(value: string, { caseSensitive = false }: { caseSensitive?: boolean } = {}): string {
  const normalised = value.normalize("NFKC").trim();
  return caseSensitive ? normalised : normalised.toLocaleLowerCase("en-US");
}

function valuesEqual(actual: unknown, expected: unknown, scoringRule: DynamicRecord, exactActual: unknown = null): boolean {
  if (Array.isArray(actual) || Array.isArray(expected)) {
    if (!Array.isArray(actual) || !Array.isArray(expected) || actual.length !== expected.length) return false;
    return actual.every((value, index) => valuesEqual(
      value,
      expected[index],
      scoringRule,
      Array.isArray(exactActual) ? exactActual[index] : null,
    ));
  }
  if (scoringRule.numericMode === "decimal" && exactActual !== null) {
    try {
      const actualDecimal = new Decimal(String(exactActual));
      const expectedDecimal = new Decimal(String(expected));
      const epsilon = new Decimal(String(finiteScore(scoringRule.numericEpsilon, 1e-6) || 1e-6));
      const relativeScale = Decimal.max(actualDecimal.abs(), expectedDecimal.abs());
      const tolerance = Decimal.max(epsilon, epsilon.times(relativeScale));
      return actualDecimal.minus(expectedDecimal).abs().lessThanOrEqualTo(tolerance);
    } catch {
      return false;
    }
  }
  if (typeof actual === "number" && typeof expected === "number") {
    if (!Number.isFinite(actual) || !Number.isFinite(expected)) return false;
    const epsilon = finiteScore(scoringRule.numericEpsilon, 1e-6) || 1e-6;
    return Math.abs(actual - expected) <= Math.max(epsilon, epsilon * Math.max(Math.abs(actual), Math.abs(expected)));
  }
  if (typeof actual === "string" && typeof expected === "string") {
    const caseSensitive = scoringRule.caseSensitiveText === true;
    return normaliseText(actual, { caseSensitive }) === normaliseText(expected, { caseSensitive });
  }
  return actual === expected;
}

export function gradeFormulaAnswer({ formula, table, answerKey, scoringRule }: {
  formula: unknown;
  table: any;
  answerKey: DynamicRecord;
  scoringRule: DynamicRecord;
}): QuestionGrade {
  const maximumScore = finiteScore(scoringRule?.maximumScore);
  const partialScore = Math.min(maximumScore, finiteScore(scoringRule?.coreFunctionMissingScore));
  const evaluation = evaluateExcelFormula({ formula, table });
  const correct = evaluation.ok && valuesEqual(
    evaluation.value,
    answerKey?.expectedValue,
    scoringRule ?? {},
    evaluation.exactValue,
  );
  const functionSets = acceptableFunctionSets(scoringRule ?? {});
  const usesRequiredFunctions = functionSets.length === 0
    || functionSets.some((names) => names.every((name) => evaluation.functions.has(name)));

  if (correct && usesRequiredFunctions) {
    return { awardedScore: maximumScore, maximumScore, status: "correct", calculatedValue: evaluation.value };
  }
  if (correct) {
    return { awardedScore: partialScore, maximumScore, status: "partial_core_function_missing", calculatedValue: evaluation.value };
  }
  return { awardedScore: 0, maximumScore, status: "incorrect", calculatedValue: evaluation.ok ? evaluation.value : null };
}

export function gradeQuestionAnswer({ question, answer }: { question: DynamicRecord; answer: unknown }): QuestionGrade {
  const maximumScore = finiteScore(question?.scoringRule?.maximumScore, 1);
  if (question?.questionMode === "choice") {
    const correct = typeof answer === "string"
      && typeof question.answerKey?.correctOption === "string"
      && normaliseText(answer).toUpperCase() === normaliseText(question.answerKey.correctOption).toUpperCase();
    return { awardedScore: correct ? maximumScore : 0, maximumScore, status: correct ? "correct" : "incorrect", calculatedValue: null };
  }
  return gradeFormulaAnswer({
    formula: answer,
    table: question?.studentPayload?.table,
    answerKey: question?.answerKey,
    scoringRule: question?.scoringRule ?? {},
  });
}

export function gradeSubmission({ questions, answers = {}, policyViolation = false }: {
  questions: readonly DynamicRecord[];
  answers?: Readonly<Record<string, unknown>>;
  policyViolation?: boolean;
}) {
  const results = questions.map((question) => {
    const grade = policyViolation
      ? { awardedScore: 0, maximumScore: finiteScore(question?.scoringRule?.maximumScore, 1), status: "incorrect", calculatedValue: null }
      : gradeQuestionAnswer({ question, answer: answers?.[question.key] ?? "" });
    return { questionKey: question.key, questionMode: question.questionMode ?? "formula", ...grade };
  });
  const totals = results.reduce((summary, result) => {
    summary.awardedScore += result.awardedScore;
    summary.maximumScore += result.maximumScore;
    if (result.questionMode === "choice") {
      summary.choiceTotal += 1;
      if (result.status === "correct") summary.choiceCorrect += 1;
    } else {
      summary.formulaTotal += 1;
      if (result.status === "correct") summary.formulaCorrect += 1;
    }
    return summary;
  }, { awardedScore: 0, maximumScore: 0, choiceCorrect: 0, choiceTotal: 0, formulaCorrect: 0, formulaTotal: 0 });
  return { status: "graded", results, totals };
}
