import type { AssessmentMode } from "../../../types/models/assessment.ts";
import type { ManualPaperRule, ManualPromptImage, ManualQuestionType } from "../../../types/models/manual-question.ts";

export type ExcelDifficulty = "easy" | "normal" | "hard" | "hell";

export interface ExcelAuthoringDraft {
  readonly kind: "excel";
  readonly name: string;
  readonly revision: number;
  readonly mode: AssessmentMode;
  readonly durationMinutes: number;
  readonly difficulty: ExcelDifficulty;
  readonly questionsPerFunction: number;
  readonly selectedFunctions: readonly string[];
}

interface ManualQuestionDraftBase {
  readonly key: string;
  readonly promptMarkdown: string;
  readonly image?: ManualPromptImage;
}

export interface ManualChoiceOptionDraft {
  readonly id: string;
  readonly markdown: string;
}

export interface ManualChoiceQuestionDraft extends ManualQuestionDraftBase {
  readonly type: "single_choice" | "multiple_choice";
  readonly options: readonly ManualChoiceOptionDraft[];
  readonly correctOptionIds: readonly string[];
}

export interface ManualBlankDraft {
  readonly id: string;
  readonly sourceText: string;
  readonly acceptedAnswers?: readonly string[];
}

export interface ManualFillBlankQuestionDraft extends ManualQuestionDraftBase {
  readonly type: "fill_blank";
  readonly editorText: string;
  readonly blanks: readonly ManualBlankDraft[];
}

export interface ManualShortAnswerQuestionDraft extends ManualQuestionDraftBase {
  readonly type: "short_answer";
  readonly referenceAnswerMarkdown: string;
}

export type ManualQuestionDraft =
  | ManualChoiceQuestionDraft
  | ManualFillBlankQuestionDraft
  | ManualShortAnswerQuestionDraft;

export interface ManualAuthoringDraft {
  readonly kind: "manual";
  readonly name: string;
  readonly revision: number;
  readonly durationMinutes: number;
  readonly paperRule: ManualPaperRule;
  readonly questions: readonly ManualQuestionDraft[];
}

export type AuthoringDraft = ExcelAuthoringDraft | ManualAuthoringDraft;

export interface RosterPreviewRow {
  readonly studentNumber: string;
  readonly name: string;
  readonly sourceFiles: readonly string[];
}

export interface RosterImportFileSummary {
  readonly name: string;
  readonly studentCount: number;
  readonly sheetCount: number;
  readonly sheets: readonly Readonly<{ name: string; studentCount: number }>[];
  readonly encoding: string | null;
  readonly originalByteLength: number;
}

export interface RosterImportResult {
  readonly text: string;
  readonly count: number;
  readonly duplicateCount: number;
  readonly sourceFileCount: number;
  readonly originalByteLength: number;
  readonly previewRows: readonly RosterPreviewRow[];
  readonly files: readonly RosterImportFileSummary[];
}

export type AuthoringDraftAction =
  | { readonly type: "set_name"; readonly name: string }
  | { readonly type: "set_duration_minutes"; readonly durationMinutes: number }
  | { readonly type: "set_excel_mode"; readonly mode: AssessmentMode }
  | { readonly type: "set_excel_difficulty"; readonly difficulty: ExcelDifficulty }
  | { readonly type: "set_questions_per_function"; readonly count: number }
  | { readonly type: "toggle_function"; readonly functionName: string }
  | { readonly type: "select_functions"; readonly functionNames: readonly string[] }
  | { readonly type: "set_manual_paper_rule"; readonly paperRule: ManualPaperRule }
  | { readonly type: "add_manual_question"; readonly questionType: ManualQuestionType }
  | { readonly type: "replace_manual_question"; readonly question: ManualQuestionDraft }
  | { readonly type: "remove_manual_question"; readonly questionKey: string }
  | { readonly type: "move_manual_question"; readonly questionKey: string; readonly direction: -1 | 1 }
  | { readonly type: "replace_draft"; readonly draft: AuthoringDraft };
