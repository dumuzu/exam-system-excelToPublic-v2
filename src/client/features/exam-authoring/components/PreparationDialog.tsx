import { Link } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

import type { AdminLocale } from "../../../shared/i18n/AdminLocaleProvider.tsx";
import { Button } from "../../../shared/ui/Button.tsx";
import { authoringCopy, authoringErrorMessage } from "../copy.ts";
import type { PreparationRunState } from "../hooks/usePreparationRunner.ts";

interface PreparationDialogProps {
  locale: AdminLocale;
  onClose: () => void;
  state: PreparationRunState;
}

export function PreparationDialog({ locale, onClose, state }: PreparationDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const t = authoringCopy[locale];
  const open = state.target !== null;
  const preparation = state.preparation;
  const ready = preparation?.status === "ready";
  const failed = preparation?.status === "failed" || state.error !== null;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      aria-labelledby="preparationDialogTitle"
      className="preparationDialog"
      onCancel={(event) => {
        if (state.running) event.preventDefault();
        else onClose();
      }}
      ref={dialogRef}
    >
      <div className="preparationDialogBody">
        <h2 id="preparationDialogTitle">{t.preparationTitle}</h2>
        <p>{t.preparationSummary(state.target?.rosterCount ?? 0, preparation?.plannedQuestionCount ?? 0)}</p>
        <progress
          aria-label={t.preparationTitle}
          className="preparationProgress"
          max={100}
          value={preparation?.percent ?? 0}
        />
        <div className="preparationMetrics">
          <strong>{preparation?.percent ?? 0}%</strong>
          <span>{preparation?.generatedQuestionCount ?? 0} / {preparation?.plannedQuestionCount ?? 0}</span>
        </div>
        <ol className="preparationSteps">
          <li data-complete="true">{locale === "ja" ? "出題内容を検証" : locale === "zh" ? "校验出题内容" : "Validate content"}</li>
          <li data-complete="true">{locale === "ja" ? "名簿を検証" : locale === "zh" ? "校验学生名册" : "Validate roster"}</li>
          <li data-active={!ready && !failed} data-complete={ready}>{locale === "ja" ? "個別問題を生成" : locale === "zh" ? "生成考试题目" : "Generate individual papers"}</li>
          <li data-complete={ready}>{locale === "ja" ? "構造と件数を確認" : locale === "zh" ? "校验结构与数量" : "Verify structure and counts"}</li>
        </ol>
        {ready ? <p className="inlineFeedback" data-tone="success">{t.preparationReady}</p> : null}
        {failed ? <p className="inlineFeedback" data-tone="error">{state.error ? authoringErrorMessage(state.error, locale) : t.preparationFailed}</p> : null}
      </div>
      <div className="preparationDialogActions">
        {ready && state.target ? <Link className="uiButton uiButtonPrimary" params={{ examCode: state.target.code }} search={{}} to="/exams/$examCode/room">{t.openRoom}</Link> : null}
        {!state.running && (ready || failed) ? <Button onClick={onClose} variant="secondary">{t.close}</Button> : null}
      </div>
    </dialog>
  );
}
