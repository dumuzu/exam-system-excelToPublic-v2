import {
  authoringConfigurationBodySchema,
  authoringPreviewBodySchema,
  publishAssessmentBodySchema,
  type AuthoringConfiguration,
  type AuthoringConfigurationBody,
  type AuthoringPreviewBody,
  type PublishAssessmentBody,
} from "../../../../types/contracts/exam-authoring.ts";
import type { ManualQuestion } from "../../../../types/models/manual-question.ts";
import type {
  AuthoringDraft,
  AuthoringDraftAction,
  ExcelAuthoringDraft,
  ExcelDifficulty,
  ManualAuthoringDraft,
  ManualQuestionDraft,
} from "../types.ts";

const defaultQuestionsPerFunction = 5;

function identifier(prefix: string): string {
  const suffix = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${suffix}`;
}

export function createManualQuestionDraft(type: ManualQuestionDraft["type"]): ManualQuestionDraft {
  const key = identifier("question");
  if (type === "single_choice" || type === "multiple_choice") {
    return {
      key,
      type,
      promptMarkdown: "",
      options: [
        { id: identifier("option"), markdown: "" },
        { id: identifier("option"), markdown: "" },
      ],
      correctOptionIds: [],
    };
  }
  if (type === "fill_blank") {
    return { key, type, promptMarkdown: "", editorText: "", blanks: [] };
  }
  return { key, type, promptMarkdown: "", referenceAnswerMarkdown: "" };
}

export function createAuthoringDraft(assessmentTypeKey: string): AuthoringDraft {
  if (assessmentTypeKey === "manual_questions") {
    return { kind: "manual", name: "", revision: 0, durationMinutes: 90, paperRule: { strategy: "all_questions" }, questions: [] };
  }
  return {
    kind: "excel",
    name: "",
    revision: 0,
    mode: "exam",
    durationMinutes: 90,
    difficulty: "normal",
    questionsPerFunction: defaultQuestionsPerFunction,
    selectedFunctions: [],
  };
}

function revise<Draft extends AuthoringDraft>(draft: Draft, change: Omit<Partial<Draft>, "revision">): Draft {
  return { ...draft, ...change, revision: draft.revision + 1 };
}

// 草稿 Reducer 只更新发生变化的题目，未编辑题卡可由 React.memo 跳过渲染。
export function authoringDraftReducer(draft: AuthoringDraft, action: AuthoringDraftAction): AuthoringDraft {
  if (action.type === "replace_draft") return action.draft;
  if (action.type === "set_name") return revise(draft, { name: action.name });
  if (action.type === "set_duration_minutes") return revise(draft, { durationMinutes: action.durationMinutes });

  if (draft.kind === "excel") {
    if (action.type === "set_excel_mode") return revise(draft, { mode: action.mode });
    if (action.type === "set_excel_difficulty") return revise(draft, { difficulty: action.difficulty });
    if (action.type === "set_questions_per_function") return revise(draft, { questionsPerFunction: action.count });
    if (action.type === "select_functions") {
      return revise(draft, { selectedFunctions: [...new Set(action.functionNames)] });
    }
    if (action.type === "toggle_function") {
      const selected = new Set(draft.selectedFunctions);
      if (selected.has(action.functionName)) selected.delete(action.functionName);
      else selected.add(action.functionName);
      return revise(draft, { selectedFunctions: [...selected] });
    }
    return draft;
  }

  if (action.type === "set_manual_paper_rule") {
    return revise(draft, { paperRule: action.paperRule });
  }
  if (action.type === "add_manual_question") {
    return revise(draft, { questions: [...draft.questions, createManualQuestionDraft(action.questionType)] });
  }
  if (action.type === "replace_manual_question") {
    const index = draft.questions.findIndex((question) => question.key === action.question.key);
    if (index < 0 || draft.questions[index] === action.question) return draft;
    const questions = draft.questions.slice();
    questions[index] = action.question;
    return revise(draft, { questions });
  }
  if (action.type === "remove_manual_question") {
    const questions = draft.questions.filter((question) => question.key !== action.questionKey);
    return questions.length === draft.questions.length ? draft : revise(draft, { questions });
  }
  if (action.type === "move_manual_question") {
    const source = draft.questions.findIndex((question) => question.key === action.questionKey);
    const destination = source + action.direction;
    if (source < 0 || destination < 0 || destination >= draft.questions.length) return draft;
    const questions = draft.questions.slice();
    [questions[source], questions[destination]] = [questions[destination]!, questions[source]!];
    return revise(draft, { questions });
  }
  return draft;
}

function fillSegments(
  question: Extract<ManualQuestionDraft, { type: "fill_blank" }>,
): Extract<ManualQuestion, { type: "fill_blank" }>["segments"] {
  const segments: Array<{ kind: "text"; markdown: string } | { kind: "blank"; id: string; acceptedAnswers?: string[] }> = [];
  const tokenPattern = /\[\[([A-Za-z0-9_-]+)\]\]/g;
  let cursor = 0;
  for (const match of question.editorText.matchAll(tokenPattern)) {
    const matchIndex = match.index ?? 0;
    if (matchIndex > cursor) segments.push({ kind: "text", markdown: question.editorText.slice(cursor, matchIndex) });
    const blank = question.blanks.find((item) => item.id === match[1]);
    if (blank) {
      const acceptedAnswers = blank.acceptedAnswers?.map((answer) => answer.trim()).filter(Boolean);
      segments.push({
        kind: "blank",
        id: blank.id,
        ...(acceptedAnswers?.length ? { acceptedAnswers } : {}),
      });
    }
    cursor = matchIndex + match[0].length;
  }
  if (cursor < question.editorText.length) {
    segments.push({ kind: "text", markdown: question.editorText.slice(cursor) });
  }
  return segments;
}

export function finalizeManualQuestion(question: ManualQuestionDraft): ManualQuestion {
  const image = question.image === undefined ? {} : { image: question.image };
  if (question.type === "single_choice" || question.type === "multiple_choice") {
    return {
      key: question.key,
      type: question.type,
      promptMarkdown: question.promptMarkdown,
      options: question.options.map((option) => ({ ...option })),
      ...(question.correctOptionIds.length ? { correctOptionIds: [...question.correctOptionIds] } : {}),
      ...image,
    };
  }
  if (question.type === "fill_blank") {
    return {
      key: question.key,
      type: "fill_blank",
      promptMarkdown: question.promptMarkdown,
      segments: fillSegments(question),
      ...image,
    };
  }
  if (question.type === "short_answer") {
    return {
      key: question.key,
      type: "short_answer",
      promptMarkdown: question.promptMarkdown,
      ...(question.referenceAnswerMarkdown.trim()
        ? { referenceAnswerMarkdown: question.referenceAnswerMarkdown }
        : {}),
      ...image,
    };
  }
  throw new TypeError("Unsupported manual question draft.");
}

export function buildAuthoringPreviewBody(draft: AuthoringDraft): AuthoringPreviewBody {
  const candidate = draft.kind === "manual"
    ? { mode: "exam", durationMinutes: draft.durationMinutes, paperRule: draft.paperRule, questions: draft.questions.map(finalizeManualQuestion) }
    : {
        mode: draft.mode,
        durationMinutes: draft.mode === "exam" ? draft.durationMinutes : null,
        difficulty: draft.difficulty,
        assignmentOptions: {
          formulaQuestionCountMode: "per_function",
          formulaQuestionCount: draft.questionsPerFunction,
          questionsPerFunction: draft.questionsPerFunction,
          choiceQuestionCount: 0,
        },
        selectedFunctions: [...draft.selectedFunctions],
      };
  return authoringPreviewBodySchema.parse(candidate);
}

export function buildAuthoringConfigurationBody(draft: AuthoringDraft): AuthoringConfigurationBody {
  return authoringConfigurationBodySchema.parse({ name: draft.name, ...buildAuthoringPreviewBody(draft) });
}

export function buildPublishAssessmentBody(draft: AuthoringDraft, rosterCsv: string): PublishAssessmentBody {
  return publishAssessmentBodySchema.parse({ name: draft.name, rosterCsv, ...buildAuthoringPreviewBody(draft) });
}

function isExcelDifficulty(value: unknown): value is ExcelDifficulty {
  return value === "easy" || value === "normal" || value === "hard" || value === "hell";
}

function questionToDraft(question: ManualQuestion): ManualQuestionDraft {
  if (question.type === "single_choice" || question.type === "multiple_choice") {
    return {
      key: question.key,
      type: question.type,
      promptMarkdown: question.promptMarkdown,
      ...(question.image === undefined ? {} : { image: question.image }),
      options: question.options.map((option) => ({ ...option })),
      correctOptionIds: [...(question.correctOptionIds ?? [])],
    };
  }
  if (question.type === "fill_blank") {
    return {
      key: question.key,
      type: "fill_blank",
      promptMarkdown: question.promptMarkdown,
      ...(question.image === undefined ? {} : { image: question.image }),
      editorText: question.segments.map((segment) => (
        segment.kind === "blank" ? `[[${segment.id}]]` : segment.markdown
      )).join(""),
      blanks: question.segments
        .filter((segment) => segment.kind === "blank")
        .map((segment) => ({
          id: segment.id,
          sourceText: segment.acceptedAnswers?.[0] ?? "",
          ...(segment.acceptedAnswers === undefined ? {} : { acceptedAnswers: [...segment.acceptedAnswers] }),
        })),
    };
  }
  return {
    key: question.key,
    type: "short_answer",
    promptMarkdown: question.promptMarkdown,
    ...(question.image === undefined ? {} : { image: question.image }),
    referenceAnswerMarkdown: question.referenceAnswerMarkdown ?? "",
  };
}

export function draftFromConfiguration(configuration: AuthoringConfiguration, name: string): AuthoringDraft {
  if (configuration.assessmentTypeKey === "manual_questions") {
    const draft: ManualAuthoringDraft = {
      kind: "manual",
      name,
      revision: 0,
      durationMinutes: configuration.durationMinutes ?? 90,
      paperRule: configuration.plan.manualPaperRule ?? { strategy: "all_questions" },
      questions: (configuration.plan.questions ?? []).map(questionToDraft),
    };
    return draft;
  }
  const questionsPerFunction = configuration.assignmentOptions["questionsPerFunction"];
  const difficulty = configuration.plan.difficulty;
  const draft: ExcelAuthoringDraft = {
    kind: "excel",
    name,
    revision: 0,
    mode: configuration.mode,
    durationMinutes: configuration.durationMinutes ?? 90,
    difficulty: isExcelDifficulty(difficulty) ? difficulty : "normal",
    questionsPerFunction: typeof questionsPerFunction === "number"
      ? questionsPerFunction
      : defaultQuestionsPerFunction,
    selectedFunctions: [...configuration.selectedFunctions],
  };
  return draft;
}
