import { memo } from "react";

import type { AuthoringPreviewResponse } from "../../../../types/contracts/exam-authoring.ts";
import type { AdminLocale } from "../../../shared/i18n/AdminLocaleProvider.tsx";
import { Badge } from "../../../shared/ui/Badge.tsx";
import { authoringCopy } from "../copy.ts";

interface AuthoringPreviewPanelProps {
  error: string | null;
  locale: AdminLocale;
  preview: Extract<AuthoringPreviewResponse, { ok: true }> | null;
  stale: boolean;
  working: boolean;
}

export const AuthoringPreviewPanel = memo(function AuthoringPreviewPanel({
  error,
  locale,
  preview,
  stale,
  working,
}: AuthoringPreviewPanelProps) {
  const t = authoringCopy[locale];
  const plan = preview?.plan ?? null;
  const manualQuestions = plan?.questions ?? [];
  const totalQuestionCount = (plan?.questionCounts.choice ?? 0) + (plan?.questionCounts.formula ?? 0);
  const presetAnswerCount = manualQuestions.filter((question) => {
    if (question.type === "single_choice" || question.type === "multiple_choice") {
      return Boolean(question.correctOptionIds?.length);
    }
    if (question.type === "fill_blank") {
      return question.segments.some((segment) => segment.kind === "blank" && Boolean(segment.acceptedAnswers?.length));
    }
    return Boolean(question.referenceAnswerMarkdown?.trim());
  }).length;
  return (
    <section aria-labelledby="authoringPreviewTitle" className="authoringSidePanel">
      <header className="authoringPanelHeader">
        <h2 id="authoringPreviewTitle">{t.previewTitle}</h2>
        {preview && !stale ? <Badge tone="success">{t.previewReady}</Badge> : null}
      </header>
      {working ? <p className="authoringPanelEmpty" aria-live="polite">{t.previewWorking}</p> : null}
      {!working && error ? <p className="inlineFeedback" data-tone="error" role="alert">{error}</p> : null}
      {!working && !error && stale ? <p className="inlineFeedback">{t.previewStale}</p> : null}
      {!working && !error && !preview ? <p className="authoringPanelEmpty">{t.previewEmpty}</p> : null}
      {!working && !error && preview && !stale ? (
        <div className="authoringPreviewContent">
          <div className="authoringPreviewMetrics">
            <div><span>{locale === "ja" ? "形式" : locale === "zh" ? "模式" : "Mode"}</span><strong>{plan?.mode === "assignment" ? t.assignment : t.exam}</strong></div>
            <div><span>{locale === "ja" ? "問題数" : locale === "zh" ? "题目数" : "Questions"}</span><strong>{totalQuestionCount}</strong></div>
            <div>
              <span>{manualQuestions.length > 0 ? (locale === "ja" ? "正答設定" : locale === "zh" ? "预设答案" : "Answer keys") : (locale === "ja" ? "対象関数" : locale === "zh" ? "考试函数" : "Functions")}</span>
              <strong>{manualQuestions.length > 0 ? `${presetAnswerCount} / ${manualQuestions.length}` : plan?.coverage.selected.length ?? 0}</strong>
            </div>
          </div>
          {manualQuestions.length > 0 ? (
            <ol className="manualPreviewList">
              {manualQuestions.map((question) => {
                const prompt = question.promptMarkdown.trim() || (question.type === "fill_blank"
                  ? question.segments.map((segment) => segment.kind === "blank" ? "＿＿" : segment.markdown).join("")
                  : "");
                return (
                  <li key={question.key}>
                    <strong>{t.questionType(question.type)}</strong>
                    <span>{prompt || "—"}</span>
                  </li>
                );
              })}
            </ol>
          ) : (
            <ul className="functionAllocationList">
              {(plan?.coverage.allocations ?? []).filter((allocation) => allocation.count > 0).map((allocation) => (
                <li key={allocation.functionName}><code>{allocation.functionName}</code><span>× {allocation.count}</span></li>
              ))}
            </ul>
          )}
          {preview.warnings.length > 0 ? <p className="inlineFeedback">{preview.warnings[0]?.message}</p> : null}
        </div>
      ) : null}
    </section>
  );
});
