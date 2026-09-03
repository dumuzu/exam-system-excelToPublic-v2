import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import type { AdminLocale } from "../../../shared/i18n/AdminLocaleProvider.tsx";
import { AsyncButton } from "../../../shared/patterns/AsyncButton.tsx";
import { InlineFeedback, PageSkeleton, QueryErrorState } from "../../../shared/patterns/PageStates.tsx";
import { Badge } from "../../../shared/ui/Badge.tsx";
import { Button } from "../../../shared/ui/Button.tsx";
import { SafeMarkdown } from "../../../shared/ui/SafeMarkdown.tsx";
import { TextField } from "../../../shared/ui/TextField.tsx";
import { useGradeAdjustmentMutation } from "../hooks/useGradeAdjustmentMutation.ts";
import { useResultDetail } from "../hooks/useResultQueries.ts";
import type { GradeAdjustmentInput, QuestionResult } from "../types.ts";

const labels = {
  ja: { title: "答案確認", close: "閉じる", loadError: "答案を読み込めません", loadErrorDescription: "通信状態を確認して、もう一度読み込んでください。", retry: "再試行", studentAnswer: "学生の回答", reference: "正答・参考答案", noReference: "未設定", empty: "回答なし", automatic: "自動", awarded: "採点", score: "点数", reason: "採点理由", reasonPlaceholder: "調整理由を入力", save: "採点を保存", saving: "保存中…", saved: "採点を保存しました。", invalidScore: "0 以上、満点以下の点数を入力してください。", invalidReason: "採点理由を 1～500 文字で入力してください。", saveError: "採点を保存できませんでした。", unknownQuestion: "問題", unknownResult: "未判定" },
  zh: { title: "答案校对", close: "关闭", loadError: "无法加载答案", loadErrorDescription: "请检查网络连接后重新加载。", retry: "重试", studentAnswer: "学生作答", reference: "预设答案 / 参考答案", noReference: "未设置", empty: "未作答", automatic: "自动评分", awarded: "当前评分", score: "分数", reason: "评分理由", reasonPlaceholder: "请输入调整理由", save: "保存评分", saving: "正在保存…", saved: "评分已保存。", invalidScore: "请输入大于等于 0 且不超过满分的分数。", invalidReason: "请输入 1 至 500 个字符的评分理由。", saveError: "无法保存评分。", unknownQuestion: "题目", unknownResult: "未判定" },
  en: { title: "Answer review", close: "Close", loadError: "Answers could not be loaded", loadErrorDescription: "Check the connection and load the answers again.", retry: "Try again", studentAnswer: "Student answer", reference: "Answer key or reference answer", noReference: "Not set", empty: "No answer", automatic: "Automatic score", awarded: "Awarded score", score: "Score", reason: "Reason for adjustment", reasonPlaceholder: "Explain the adjustment", save: "Save grade", saving: "Saving…", saved: "Grade saved.", invalidScore: "Enter a score from 0 to the maximum score.", invalidReason: "Enter a reason between 1 and 500 characters.", saveError: "The grade could not be saved.", unknownQuestion: "Question", unknownResult: "Not evaluated" },
} as const;

const questionModeLabels: Record<string, Record<AdminLocale, string>> = {
  choice: { ja: "選択問題", zh: "选择题", en: "Choice" }, formula: { ja: "数式問題", zh: "公式题", en: "Formula" },
  single_choice: { ja: "単一選択", zh: "单选题", en: "Single choice" }, multiple_choice: { ja: "複数選択", zh: "多选题", en: "Multiple choice" },
  fill_blank: { ja: "穴埋め", zh: "填空题", en: "Fill in the blank" }, short_answer: { ja: "記述式", zh: "简答题", en: "Short answer" },
};

const resultStatusLabels: Record<string, { tone: "success" | "warning" | "danger" | "neutral"; ja: string; zh: string; en: string }> = {
  correct: { tone: "success", ja: "正解", zh: "正确", en: "Correct" }, incorrect: { tone: "danger", ja: "不正解", zh: "错误", en: "Incorrect" },
  review_required: { tone: "warning", ja: "確認待ち", zh: "待校对", en: "Review required" }, unanswered: { tone: "neutral", ja: "未回答", zh: "未作答", en: "Unanswered" },
};

function promptMarkdown(question: QuestionResult): string {
  const prompt = question.prompt;
  if (!prompt) return question.questionKey;
  if (typeof prompt["promptMarkdown"] === "string" && prompt["promptMarkdown"].trim()) return prompt["promptMarkdown"];
  if (Array.isArray(prompt["segments"])) {
    return prompt["segments"].map((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return "";
      const segment = value as Record<string, unknown>;
      if (segment["kind"] === "blank") return ` **[${String(segment["id"] ?? "")}]** `;
      return typeof segment["markdown"] === "string" ? segment["markdown"] : "";
    }).join("");
  }
  return typeof prompt["promptJa"] === "string" ? prompt["promptJa"] : question.questionKey;
}

function AnswerValue({ empty, value }: { empty: string; value: unknown }) {
  if (typeof value === "string") return value.trim() ? <SafeMarkdown className="reviewValue" markdown={value} /> : <p className="reviewValue">{empty}</p>;
  if (Array.isArray(value)) return value.length > 0 ? <div className="reviewValue reviewAnswerChips">{value.map((item, index) => <code key={`${String(item)}-${index}`}>{String(item)}</code>)}</div> : <p className="reviewValue">{empty}</p>;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    return entries.length > 0 ? <div className="reviewValue">{entries.map(([key, item]) => <div className="reviewAnswerRow" key={key}><code>{key}</code><span>{Array.isArray(item) ? item.join(" / ") : String(item ?? "")}</span></div>)}</div> : <p className="reviewValue">{empty}</p>;
  }
  return <p className="reviewValue">{empty}</p>;
}

function GradeAdjustmentForm({ initialScore, input, locale, maximumScore, pending, onSubmit }: {
  input: Omit<GradeAdjustmentInput, "newScore" | "reason">;
  initialScore: number;
  locale: AdminLocale;
  maximumScore: number;
  pending: boolean;
  onSubmit: (input: GradeAdjustmentInput, clearReason: () => void) => void;
}) {
  const t = labels[locale];
  const [score, setScore] = useState(String(initialScore));
  const [reason, setReason] = useState("");
  const [scoreError, setScoreError] = useState<string | null>(null);
  const [reasonError, setReasonError] = useState<string | null>(null);
  const scoreId = `score-${input.gradeResultId}`;
  const reasonId = `reason-${input.gradeResultId}`;

  const focusField = (id: string) => {
    requestAnimationFrame(() => document.getElementById(id)?.focus());
  };

  return (
    <form className="gradeAdjustmentForm" onSubmit={(event) => {
      event.preventDefault();
      const newScore = Number(score);
      const normalizedReason = reason.normalize("NFKC").trim();
      if (!Number.isFinite(newScore) || newScore < 0 || newScore > maximumScore) {
        setScoreError(t.invalidScore);
        setReasonError(null);
        focusField(scoreId);
        return;
      }
      if (normalizedReason.length < 1 || normalizedReason.length > 500) {
        setScoreError(null);
        setReasonError(t.invalidReason);
        focusField(reasonId);
        return;
      }
      setScoreError(null);
      setReasonError(null);
      onSubmit({ ...input, newScore, reason: normalizedReason }, () => setReason(""));
    }}>
      <TextField {...(scoreError ? { error: scoreError } : {})} id={scoreId} label={`${t.score} / ${maximumScore}`} max={maximumScore} min={0} onChange={(event) => setScore(event.currentTarget.value)} required step="0.01" type="number" value={score} />
      <TextField {...(reasonError ? { error: reasonError } : {})} id={reasonId} label={t.reason} maxLength={500} onChange={(event) => setReason(event.currentTarget.value)} placeholder={t.reasonPlaceholder} required value={reason} />
      <AsyncButton pending={pending} pendingLabel={t.saving} type="submit" variant="primary">{t.save}</AsyncButton>
    </form>
  );
}

function QuestionCard({ canAdjust, csrfToken, examCode, locale, onAdjust, pendingGradeResultId, question, questionIndex, studentNumber, subjectId }: {
  canAdjust: boolean;
  csrfToken: string;
  examCode: string;
  locale: AdminLocale;
  onAdjust: (input: GradeAdjustmentInput, clearReason: () => void) => void;
  pendingGradeResultId: string | null;
  question: QuestionResult;
  questionIndex: number;
  studentNumber: string;
  subjectId: string;
}) {
  const t = labels[locale];
  const modeLabel = questionModeLabels[question.questionMode]?.[locale] ?? t.unknownQuestion;
  const status = resultStatusLabels[question.resultStatus] ?? { tone: "neutral" as const, ja: t.unknownResult, zh: t.unknownResult, en: t.unknownResult };
  const titleId = `reviewQuestion-${question.gradeResultId}`;
  return (
    <article aria-labelledby={titleId} className="reviewQuestionCard">
      <header><h3 id={titleId}>Q{questionIndex + 1} · {modeLabel}</h3><Badge tone={status.tone}>{status[locale]}</Badge></header>
      <SafeMarkdown className="reviewPrompt" markdown={promptMarkdown(question)} />
      <div className="reviewComparison">
        <section><h3>{t.studentAnswer}</h3><AnswerValue empty={t.empty} value={question.answer} /></section>
        <section><h3>{t.reference}</h3><AnswerValue empty={t.noReference} value={question.referenceAnswer} /></section>
      </div>
      <dl className="questionScoreSummary">
        <div><dt>{t.automatic}</dt><dd>{question.automaticScore} / {question.maximumScore}</dd></div>
        <div><dt>{t.awarded}</dt><dd>{question.awardedScore} / {question.maximumScore}</dd></div>
      </dl>
      {canAdjust ? (
        <GradeAdjustmentForm
          input={{ csrfToken, examCode, gradeResultId: question.gradeResultId, studentNumber, subjectId }}
          initialScore={question.awardedScore}
          locale={locale}
          maximumScore={question.maximumScore}
          onSubmit={onAdjust}
          pending={pendingGradeResultId === question.gradeResultId}
        />
      ) : null}
    </article>
  );
}

export function ResultReviewDialog({ canAdjust, csrfToken, examCode, locale, onClose, studentNumber, subjectId }: {
  canAdjust: boolean;
  csrfToken: string;
  examCode: string;
  locale: AdminLocale;
  onClose: () => void;
  studentNumber: string | null;
  subjectId: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const detailQuery = useResultDetail(subjectId, examCode, studentNumber);
  const adjustmentMutation = useGradeAdjustmentMutation();
  const [feedback, setFeedback] = useState<"error" | null>(null);
  const t = labels[locale];

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (studentNumber && !dialog.open) dialog.showModal();
    if (!studentNumber && dialog.open) dialog.close();
  }, [studentNumber]);

  useEffect(() => {
    setFeedback(null);
    adjustmentMutation.reset();
  }, [examCode, studentNumber]);

  const submitAdjustment = (input: GradeAdjustmentInput, clearReason: () => void) => {
    setFeedback(null);
    adjustmentMutation.mutate(input, {
      onSuccess: () => { clearReason(); toast.success(t.saved); },
      onError: () => setFeedback("error"),
    });
  };

  return (
    <dialog aria-labelledby="resultReviewTitle" className="resultReviewDialog" onCancel={(event) => { if (adjustmentMutation.isPending) event.preventDefault(); }} onClose={onClose} ref={dialogRef}>
      <header className="resultReviewHeader">
        <div><h2 id="resultReviewTitle">{t.title}</h2>{detailQuery.data ? <p>{detailQuery.data.student.name} · {detailQuery.data.student.studentNumber}</p> : null}</div>
        <Button aria-label={t.close} disabled={adjustmentMutation.isPending} onClick={() => dialogRef.current?.close()} variant="quiet">×</Button>
      </header>
      <div className="resultReviewBody">
        {feedback ? <InlineFeedback tone="error">{t.saveError}</InlineFeedback> : null}
        {detailQuery.isLoading ? <PageSkeleton rows={6} /> : null}
        {detailQuery.isError ? <QueryErrorState description={t.loadErrorDescription} onRetry={() => void detailQuery.refetch()} retryLabel={t.retry} title={t.loadError} /> : null}
        {detailQuery.data ? (
          <div className="reviewQuestionList">
            {detailQuery.data.questions.map((question, questionIndex) => (
              <QuestionCard
                canAdjust={canAdjust}
                csrfToken={csrfToken}
                examCode={examCode}
                key={question.gradeResultId}
                locale={locale}
                onAdjust={submitAdjustment}
                pendingGradeResultId={adjustmentMutation.isPending ? adjustmentMutation.variables.gradeResultId : null}
                question={question}
                questionIndex={questionIndex}
                studentNumber={detailQuery.data.student.studentNumber}
                subjectId={subjectId}
              />
            ))}
          </div>
        ) : null}
      </div>
    </dialog>
  );
}
