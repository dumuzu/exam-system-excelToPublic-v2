import { createHash } from "node:crypto";

import type { Result } from "../../platform/assessment-contracts.ts";
import type { AssessmentTypeAdapter, AssessmentWorkspaceCapabilities } from "../../core/assessment-kernel.ts";
import { BROWSER_THREE_STRIKE_POLICY_ID } from "../../core/integrity-policy.ts";
import { MANUAL_QUESTION_TYPES } from "../../types/models/manual-question.ts";
import type {
  ManualBlankSegment,
  ManualChoiceOption,
  ManualFillBlankQuestion,
  ManualMultipleChoiceQuestion,
  ManualPromptImage,
  ManualPaperRule,
  ManualQuestion,
  ManualQuestionType,
  ManualShortAnswerQuestion,
  ManualSingleChoiceQuestion,
  ManualTextSegment,
} from "../../types/models/manual-question.ts";

export { MANUAL_QUESTION_TYPES } from "../../types/models/manual-question.ts";
export type {
  ManualBlankSegment,
  ManualChoiceOption,
  ManualFillBlankQuestion,
  ManualMultipleChoiceQuestion,
  ManualPromptImage,
  ManualPaperRule,
  ManualQuestion,
  ManualQuestionType,
  ManualShortAnswerQuestion,
  ManualSingleChoiceQuestion,
  ManualTextSegment,
} from "../../types/models/manual-question.ts";

export const MANUAL_ASSESSMENT_TYPE_KEY = "manual_questions" as const;
type ManualResultStatus = "correct" | "incorrect" | "review_required";

export interface ManualAssessmentConfiguration {
  readonly questions: readonly ManualQuestion[];
  readonly paperRule: ManualPaperRule;
}

export interface ManualPreparedQuestion {
  readonly key: string;
  readonly questionMode: ManualQuestionType;
  readonly studentPayload: Readonly<Record<string, unknown>>;
  readonly answerKey: Readonly<Record<string, unknown>>;
  readonly scoringRule: Readonly<Record<string, unknown>>;
}

export interface ManualPreparedPaper {
  readonly questions: readonly ManualPreparedQuestion[];
}

export interface ManualStudentView {
  readonly questions: readonly Readonly<Record<string, unknown>>[];
}

export type ManualResponse = Readonly<Record<string, string | readonly string[] | Readonly<Record<string, string>>>>;

export interface ManualQuestionGrade {
  readonly questionKey: string;
  readonly awardedScore: number;
  readonly maximumScore: number;
  readonly resultStatus: ManualResultStatus;
  readonly referenceAnswer?: unknown;
}

export interface ManualAssessmentGrade {
  readonly awardedScore: number;
  readonly maximumScore: number;
  readonly gradingStatus: "graded" | "review_required";
  readonly questionGrades: readonly ManualQuestionGrade[];
}

const questionKeyPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const imagePattern = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/;
const maxPromptLength = 20_000;
const maxAnswerLength = 20_000;
const maxImageBytes = 1_500_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function error(code: string, message: string, details?: Readonly<Record<string, unknown>>): Result<never> {
  return details === undefined
    ? { ok: false, errors: [{ code, message }] }
    : { ok: false, errors: [{ code, message, details }] };
}

function text(value: unknown, maximumLength: number, { allowEmpty = false } = {}): string | null {
  if (typeof value !== "string" || value.includes("\0") || value.length > maximumLength) return null;
  const normalized = value.replace(/\r\n?/g, "\n");
  return allowEmpty || normalized.trim().length > 0 ? normalized : null;
}

function identifier(value: unknown): string | null {
  return typeof value === "string" && questionKeyPattern.test(value) ? value : null;
}

function validatePaperRule(value: unknown, questionBankSize: number): ManualPaperRule | null {
  if (value === undefined) return { strategy: "all_questions" };
  if (!isRecord(value)) return null;
  if (value["strategy"] === "all_questions") {
    return Object.keys(value).length === 1 ? { strategy: "all_questions" } : null;
  }
  if (value["strategy"] !== "random_subset" || Object.keys(value).some((key) => !["strategy", "questionCount"].includes(key))) {
    return null;
  }
  const questionCount = value["questionCount"];
  return Number.isInteger(questionCount) && Number(questionCount) > 0 && Number(questionCount) <= questionBankSize
    ? { strategy: "random_subset", questionCount: Number(questionCount) }
    : null;
}

function selectPreparedQuestions(
  questions: readonly ManualQuestion[],
  paperRule: ManualPaperRule,
  { eventId, participantKey, seed }: { eventId: string; participantKey: string; seed: string },
): ManualQuestion[] {
  if (paperRule.strategy === "all_questions") return [...questions];
  // 发布准备阶段使用稳定哈希排序：同一学生永远复用同一张试卷，不在页面刷新时重新随机。
  return questions
    .map((question) => ({
      question,
      rank: createHash("sha256")
        .update(`${eventId}\0${seed}\0${participantKey}\0${question.key}`)
        .digest("hex"),
    }))
    .sort((left, right) => left.rank.localeCompare(right.rank) || left.question.key.localeCompare(right.question.key))
    .slice(0, paperRule.questionCount)
    .map(({ question }) => question);
}

function promptImage(value: unknown): ManualPromptImage | null | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return null;
  const alt = text(value["alt"], 300, { allowEmpty: true });
  if (alt === null || typeof value["dataUrl"] !== "string") return null;
  const match = value["dataUrl"].match(imagePattern);
  if (!match) return null;
  const base64 = match[2]!;
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  if (Math.floor(base64.length * 3 / 4) - padding > maxImageBytes) return null;
  const bytes = Buffer.from(base64, "base64");
  const mimeType = match[1];
  const validSignature = mimeType === "png"
    ? bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    : mimeType === "jpeg"
      ? bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
      : bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
  if (!validSignature) return null;
  return { dataUrl: value["dataUrl"], alt };
}

function choiceOptions(value: unknown): ManualChoiceOption[] | null {
  if (!Array.isArray(value) || value.length < 2 || value.length > 20) return null;
  const options: ManualChoiceOption[] = [];
  const ids = new Set<string>();
  for (const candidate of value) {
    if (!isRecord(candidate)) return null;
    const id = identifier(candidate["id"]);
    const markdown = text(candidate["markdown"], 5_000);
    if (!id || !markdown || ids.has(id)) return null;
    ids.add(id);
    options.push({ id, markdown });
  }
  return options;
}

function optionalChoiceKey(value: unknown, optionIds: ReadonlySet<string>, multiple: boolean): string[] | null | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== "string")) return null;
  const unique = [...new Set(value)];
  if (unique.length !== value.length || unique.some((id) => !optionIds.has(id))) return null;
  if (!multiple && unique.length !== 1) return null;
  return unique;
}

function validateQuestion(value: unknown): ManualQuestion | null {
  if (!isRecord(value)) return null;
  const key = identifier(value["key"]);
  const promptMarkdown = text(value["promptMarkdown"], maxPromptLength, { allowEmpty: value["type"] === "fill_blank" });
  const image = promptImage(value["image"]);
  if (!key || promptMarkdown === null || image === null || !MANUAL_QUESTION_TYPES.includes(value["type"] as ManualQuestionType)) return null;
  const base = image === undefined ? { key, promptMarkdown } : { key, promptMarkdown, image };

  if (value["type"] === "single_choice" || value["type"] === "multiple_choice") {
    const options = choiceOptions(value["options"]);
    if (!options) return null;
    const correctOptionIds = optionalChoiceKey(
      value["correctOptionIds"],
      new Set(options.map((option) => option.id)),
      value["type"] === "multiple_choice",
    );
    if (correctOptionIds === null) return null;
    if (value["type"] === "single_choice") {
      return correctOptionIds === undefined
        ? { ...base, type: "single_choice", options }
        : { ...base, type: "single_choice", options, correctOptionIds };
    }
    return correctOptionIds === undefined
      ? { ...base, type: "multiple_choice", options }
      : { ...base, type: "multiple_choice", options, correctOptionIds };
  }

  if (value["type"] === "fill_blank") {
    if (!Array.isArray(value["segments"]) || value["segments"].length === 0) return null;
    const blankIds = new Set<string>();
    const segments: Array<ManualTextSegment | ManualBlankSegment> = [];
    for (const candidate of value["segments"]) {
      if (!isRecord(candidate)) return null;
      if (candidate["kind"] === "text") {
        const markdown = text(candidate["markdown"], maxPromptLength);
        if (!markdown) return null;
        segments.push({ kind: "text", markdown });
        continue;
      }
      if (candidate["kind"] !== "blank") return null;
      const id = identifier(candidate["id"]);
      if (!id || blankIds.has(id)) return null;
      blankIds.add(id);
      if (candidate["acceptedAnswers"] === undefined) {
        segments.push({ kind: "blank", id });
        continue;
      }
      if (!Array.isArray(candidate["acceptedAnswers"]) || candidate["acceptedAnswers"].length === 0 || candidate["acceptedAnswers"].length > 10) return null;
      const acceptedAnswers = candidate["acceptedAnswers"].map((answer) => text(answer, 500)).filter((answer): answer is string => answer !== null);
      if (acceptedAnswers.length !== candidate["acceptedAnswers"].length) return null;
      segments.push({ kind: "blank", id, acceptedAnswers });
    }
    if (blankIds.size === 0) return null;
    return { ...base, type: "fill_blank", segments };
  }

  const referenceAnswerMarkdown = value["referenceAnswerMarkdown"] === undefined
    ? undefined
    : text(value["referenceAnswerMarkdown"], maxAnswerLength);
  if (referenceAnswerMarkdown === null) return null;
  return referenceAnswerMarkdown === undefined
    ? { ...base, type: "short_answer" }
    : { ...base, type: "short_answer", referenceAnswerMarkdown };
}

function normalizeComparable(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("en-US");
}

function exactSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value) => right.includes(value));
}

function workspace(): AssessmentWorkspaceCapabilities {
  return {
    mode: "exam",
    responseKind: "manual_question_map",
    automaticGrading: false,
    requiresAdmission: true,
    requiresFullscreen: true,
    hasTimeLimit: true,
    proctoringEnabled: true,
    autosaveEnabled: true,
    sharedPaper: false,
    randomizeQuestionOrder: false,
    revealScoreAfterSubmission: false,
    maximumAttempts: null,
  };
}

function gradeQuestion(question: ManualPreparedQuestion, response: ManualResponse[string] | undefined): ManualQuestionGrade {
  const maximumScore = 1;
  if (question.questionMode === "single_choice" || question.questionMode === "multiple_choice") {
    const expected = Array.isArray(question.answerKey["correctOptionIds"])
      ? question.answerKey["correctOptionIds"].filter((item): item is string => typeof item === "string")
      : null;
    if (!expected) return { questionKey: question.key, awardedScore: 0, maximumScore, resultStatus: "review_required" };
    const actual = typeof response === "string" ? [response] : Array.isArray(response) ? [...response] : [];
    const correct = exactSet(actual, expected);
    return { questionKey: question.key, awardedScore: correct ? 1 : 0, maximumScore, resultStatus: correct ? "correct" : "incorrect", referenceAnswer: expected };
  }
  if (question.questionMode === "fill_blank") {
    const expected = isRecord(question.answerKey["acceptedAnswersByBlank"])
      ? question.answerKey["acceptedAnswersByBlank"]
      : {};
    const blankIds = Array.isArray(question.scoringRule["blankIds"])
      ? question.scoringRule["blankIds"].filter((item): item is string => typeof item === "string")
      : [];
    const actual = isRecord(response) ? response : {};
    if (blankIds.some((id) => !Array.isArray(expected[id]))) {
      return { questionKey: question.key, awardedScore: 0, maximumScore, resultStatus: "review_required", referenceAnswer: expected };
    }
    const correctCount = blankIds.filter((id) => {
      const answer = typeof actual[id] === "string" ? normalizeComparable(actual[id]) : "";
      return (expected[id] as unknown[]).some((candidate) => typeof candidate === "string" && normalizeComparable(candidate) === answer);
    }).length;
    const awardedScore = blankIds.length === 0 ? 0 : correctCount / blankIds.length;
    return { questionKey: question.key, awardedScore, maximumScore, resultStatus: awardedScore === 1 ? "correct" : "incorrect", referenceAnswer: expected };
  }
  return {
    questionKey: question.key,
    awardedScore: 0,
    maximumScore,
    resultStatus: "review_required",
    ...(question.answerKey["referenceAnswerMarkdown"] === undefined ? {} : { referenceAnswer: question.answerKey["referenceAnswerMarkdown"] }),
  };
}

const adapter: AssessmentTypeAdapter<
  ManualAssessmentConfiguration,
  ManualPreparedPaper,
  ManualStudentView,
  ManualResponse,
  ManualAssessmentGrade
> = {
  descriptor: Object.freeze({
    key: MANUAL_ASSESSMENT_TYPE_KEY,
    version: 1,
    supportedModes: Object.freeze(["exam"] as const),
    compatibleIntegrityPolicyIds: Object.freeze([BROWSER_THREE_STRIKE_POLICY_ID]),
  }),

  getStudentWorkspaceCapabilities(mode) {
    if (mode !== "exam") throw new TypeError("UNSUPPORTED_MANUAL_ASSESSMENT_MODE");
    return workspace();
  },

  validateAuthoring({ mode, input }) {
    if (mode !== "exam" || !isRecord(input) || !Array.isArray(input["questions"]) || input["questions"].length === 0) {
      return error("INVALID_MANUAL_CONFIGURATION", "At least one valid teacher-authored question is required.");
    }
    const questions = input["questions"].map(validateQuestion);
    if (questions.some((question) => question === null)) {
      return error("INVALID_MANUAL_QUESTION", "A teacher-authored question is invalid.");
    }
    const validQuestions = questions as ManualQuestion[];
    const keys = new Set(validQuestions.map((question) => question.key));
    if (keys.size !== validQuestions.length) return error("DUPLICATE_MANUAL_QUESTION_KEY", "Question keys must be unique.");
    const paperRule = validatePaperRule(input["paperRule"], validQuestions.length);
    if (!paperRule) {
      return error(
        "INVALID_MANUAL_PAPER_RULE",
        "The paper selection rule must use all questions or choose a positive count within the question bank.",
      );
    }
    return { ok: true, value: { questions: structuredClone(validQuestions), paperRule } };
  },

  async preparePaper({ eventId, mode, scope, seed, configuration }) {
    if (mode !== "exam" || scope.kind !== "participant") {
      return error("INVALID_MANUAL_PREPARATION_SCOPE", "Teacher-authored formal exams require participant-scoped papers.");
    }
    const selectedQuestions = selectPreparedQuestions(configuration.questions, configuration.paperRule, {
      eventId,
      participantKey: scope.participantKey,
      seed,
    });
    const questions = selectedQuestions.map((question): ManualPreparedQuestion => {
      const { key, type: questionMode } = question;
      if (question.type === "single_choice" || question.type === "multiple_choice") {
        return {
          key,
          questionMode,
          studentPayload: {
            promptMarkdown: question.promptMarkdown,
            ...(question.image ? { image: question.image } : {}),
            options: question.options,
          },
          answerKey: question.correctOptionIds === undefined ? {} : { correctOptionIds: question.correctOptionIds },
          scoringRule: { version: "manual-choice-v1" },
        };
      }
      if (question.type === "fill_blank") {
        const acceptedAnswersByBlank: Record<string, readonly string[]> = {};
        const blankIds: string[] = [];
        const segments = question.segments.map((segment) => {
          if (segment.kind === "text") return segment;
          blankIds.push(segment.id);
          if (segment.acceptedAnswers) acceptedAnswersByBlank[segment.id] = segment.acceptedAnswers;
          return { kind: "blank" as const, id: segment.id };
        });
        return {
          key,
          questionMode,
          studentPayload: { promptMarkdown: question.promptMarkdown, ...(question.image ? { image: question.image } : {}), segments },
          answerKey: { acceptedAnswersByBlank },
          scoringRule: { version: "manual-fill-blank-v1", blankIds },
        };
      }
      return {
        key,
        questionMode,
        studentPayload: {
          promptMarkdown: question.promptMarkdown,
          ...(question.image ? { image: question.image } : {}),
        },
        answerKey: question.referenceAnswerMarkdown === undefined ? {} : { referenceAnswerMarkdown: question.referenceAnswerMarkdown },
        scoringRule: { version: "manual-review-v1" },
      };
    });
    return { ok: true, value: { questions: structuredClone(questions) } };
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
    if (!isRecord(input)) return error("INVALID_MANUAL_RESPONSE", "Responses must be a question-to-answer object.");
    const questions = new Map(paper.questions.map((question) => [question.key, question]));
    const response: Record<string, string | readonly string[] | Readonly<Record<string, string>>> = {};
    for (const [questionKey, value] of Object.entries(input)) {
      const question = questions.get(questionKey);
      if (!question) return error("UNKNOWN_MANUAL_QUESTION", "A response references an unknown question.");
      if (question.questionMode === "single_choice") {
        if (typeof value !== "string" || value.length > 64) return error("INVALID_MANUAL_RESPONSE", "A single-choice response is invalid.");
        response[questionKey] = value;
      } else if (question.questionMode === "multiple_choice") {
        if (!Array.isArray(value) || value.length > 20 || value.some((item) => typeof item !== "string" || item.length > 64) || new Set(value).size !== value.length) {
          return error("INVALID_MANUAL_RESPONSE", "A multiple-choice response is invalid.");
        }
        response[questionKey] = [...value] as string[];
      } else if (question.questionMode === "fill_blank") {
        if (!isRecord(value)) return error("INVALID_MANUAL_RESPONSE", "A fill-blank response is invalid.");
        const blanks: Record<string, string> = {};
        for (const [blankId, answer] of Object.entries(value)) {
          if (!identifier(blankId) || typeof answer !== "string" || answer.length > 500) return error("INVALID_MANUAL_RESPONSE", "A fill-blank response is invalid.");
          blanks[blankId] = answer;
        }
        response[questionKey] = blanks;
      } else {
        if (typeof value !== "string" || value.length > maxAnswerLength || value.includes("\0")) return error("INVALID_MANUAL_RESPONSE", "A short-answer response is invalid.");
        response[questionKey] = value.replace(/\r\n?/g, "\n");
      }
    }
    return { ok: true, value: response };
  },

  gradeResponse({ paper, response }) {
    const questionGrades = paper.questions.map((question) => gradeQuestion(question, response[question.key]));
    return {
      awardedScore: questionGrades.reduce((sum, grade) => sum + grade.awardedScore, 0),
      maximumScore: questionGrades.reduce((sum, grade) => sum + grade.maximumScore, 0),
      gradingStatus: questionGrades.some((grade) => grade.resultStatus === "review_required") ? "review_required" : "graded",
      questionGrades,
    };
  },
};

export const manualAssessmentAdapter = Object.freeze(adapter);
