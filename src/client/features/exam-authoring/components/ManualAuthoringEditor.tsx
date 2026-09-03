import { memo, useRef } from "react";

import type { ManualPaperRule, ManualPromptImage, ManualQuestionType } from "../../../../types/models/manual-question.ts";
import type { AdminLocale } from "../../../shared/i18n/AdminLocaleProvider.tsx";
import { Button } from "../../../shared/ui/Button.tsx";
import { TextField } from "../../../shared/ui/TextField.tsx";
import { TextareaField } from "../../../shared/ui/TextareaField.tsx";
import { authoringCopy } from "../copy.ts";
import type {
  ManualAuthoringDraft,
  ManualChoiceQuestionDraft,
  ManualFillBlankQuestionDraft,
  ManualQuestionDraft,
  ManualShortAnswerQuestionDraft,
} from "../types.ts";

interface ManualAuthoringEditorProps {
  draft: ManualAuthoringDraft;
  locale: AdminLocale;
  onAdd: (type: ManualQuestionType) => void;
  onChange: (question: ManualQuestionDraft) => void;
  onMove: (questionKey: string, direction: -1 | 1) => void;
  onPaperRuleChange: (paperRule: ManualPaperRule) => void;
  onRemove: (questionKey: string) => void;
}

interface ManualQuestionCardProps {
  index: number;
  isFirst: boolean;
  isLast: boolean;
  locale: AdminLocale;
  onChange: (question: ManualQuestionDraft) => void;
  onMove: (questionKey: string, direction: -1 | 1) => void;
  onRemove: (questionKey: string) => void;
  question: ManualQuestionDraft;
}

function localIdentifier(prefix: string): string {
  const suffix = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${suffix}`;
}

async function readPromptImage(file: File): Promise<ManualPromptImage> {
  if (!(["image/png", "image/jpeg", "image/webp"].includes(file.type)) || file.size <= 0 || file.size > 1_500_000) {
    throw new Error("INVALID_PROMPT_IMAGE");
  }
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("INVALID_PROMPT_IMAGE")), { once: true });
    reader.addEventListener("error", () => reject(new Error("INVALID_PROMPT_IMAGE")), { once: true });
    reader.readAsDataURL(file);
  });
  return { dataUrl, alt: "" };
}

function ChoiceQuestionFields({ locale, onChange, question }: {
  locale: AdminLocale;
  onChange: (question: ManualChoiceQuestionDraft) => void;
  question: ManualChoiceQuestionDraft;
}) {
  const t = authoringCopy[locale];
  return (
    <div className="manualChoiceOptions">
      <span className="fieldLabel">{t.options}</span>
      {question.options.map((option, optionIndex) => {
        const isCorrect = question.correctOptionIds.includes(option.id);
        return (
          <div className="manualChoiceRow" key={option.id}>
            <label className="manualCorrectToggle" title={t.presetAnswer}>
              <input
                aria-label={`${t.presetAnswer} ${optionIndex + 1}`}
                checked={isCorrect}
                name={question.type === "single_choice" ? `${question.key}CorrectOption` : undefined}
                onChange={(event) => {
                  const next = new Set(question.correctOptionIds);
                  if (event.currentTarget.checked) {
                    if (question.type === "single_choice") next.clear();
                    next.add(option.id);
                  } else next.delete(option.id);
                  onChange({ ...question, correctOptionIds: [...next] });
                }}
                type={question.type === "single_choice" ? "radio" : "checkbox"}
              />
            </label>
            <input
              aria-label={`${t.options} ${optionIndex + 1}`}
              className="textField"
              maxLength={5_000}
              onChange={(event) => onChange({
                ...question,
                options: question.options.map((item) => item.id === option.id ? { ...item, markdown: event.currentTarget.value } : item),
              })}
              value={option.markdown}
            />
            <Button
              aria-label={`${t.remove} ${optionIndex + 1}`}
              disabled={question.options.length <= 2}
              onClick={() => onChange({
                ...question,
                options: question.options.filter((item) => item.id !== option.id),
                correctOptionIds: question.correctOptionIds.filter((id) => id !== option.id),
              })}
              variant="quiet"
            >×</Button>
          </div>
        );
      })}
      <div className="manualInlineActions">
        <Button
          disabled={question.options.length >= 20}
          onClick={() => onChange({
            ...question,
            options: [...question.options, { id: localIdentifier("option"), markdown: "" }],
          })}
          variant="secondary"
        >{t.addOption}</Button>
        <Button
          disabled={question.correctOptionIds.length === 0}
          onClick={() => onChange({ ...question, correctOptionIds: [] })}
          variant="quiet"
        >{t.clearAnswer}</Button>
      </div>
    </div>
  );
}

function FillBlankQuestionFields({ locale, onChange, question }: {
  locale: AdminLocale;
  onChange: (question: ManualFillBlankQuestionDraft) => void;
  question: ManualFillBlankQuestionDraft;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const t = authoringCopy[locale];
  const markBlank = () => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const sourceText = textarea.value.slice(start, end);
    if (!sourceText.trim() || /\[\[|\]\]/.test(sourceText)) {
      textarea.setCustomValidity(locale === "ja" ? "空欄にする語句を選択してください。" : locale === "zh" ? "请先选中要设为空格的文字。" : "Select the text that should become a blank.");
      textarea.reportValidity();
      return;
    }
    textarea.setCustomValidity("");
    const id = localIdentifier("blank");
    onChange({
      ...question,
      editorText: `${question.editorText.slice(0, start)}[[${id}]]${question.editorText.slice(end)}`,
      blanks: [...question.blanks, { id, sourceText, acceptedAnswers: [sourceText.trim()] }],
    });
  };

  return (
    <div className="manualFillEditor">
      <TextareaField
        hint={t.fillHint}
        id={`${question.key}Passage`}
        label={t.fillPassage}
        maxLength={20_000}
        onChange={(event) => onChange({ ...question, editorText: event.currentTarget.value })}
        textareaRef={textareaRef}
        rows={7}
        value={question.editorText}
      />
      <Button onClick={markBlank} variant="secondary">{t.markBlank}</Button>
      {question.blanks.filter((blank) => question.editorText.includes(`[[${blank.id}]]`)).map((blank) => (
        <div className="manualBlankRow" key={blank.id}>
          <code>{`[[${blank.id}]]`}</code>
          <label className="manualAnswerToggle">
            <input
              checked={blank.acceptedAnswers !== undefined}
              onChange={(event) => onChange({
                ...question,
                blanks: question.blanks.map((item) => item.id === blank.id
                  ? event.currentTarget.checked
                    ? { ...item, acceptedAnswers: item.acceptedAnswers ?? [item.sourceText].filter(Boolean) }
                    : { id: item.id, sourceText: item.sourceText }
                  : item),
              })}
              type="checkbox"
            />
            <span>{t.enableAnswer}</span>
          </label>
          <textarea
            aria-label={t.acceptedAnswers}
            className="textareaField"
            disabled={blank.acceptedAnswers === undefined}
            onChange={(event) => onChange({
              ...question,
              blanks: question.blanks.map((item) => item.id === blank.id
                ? { ...item, acceptedAnswers: event.currentTarget.value.split("\n").map((value) => value.trim()).filter(Boolean) }
                : item),
            })}
            placeholder={t.acceptedAnswers}
            rows={2}
            value={blank.acceptedAnswers?.join("\n") ?? ""}
          />
          <Button
            aria-label={t.remove}
            onClick={() => onChange({
              ...question,
              editorText: question.editorText.replace(`[[${blank.id}]]`, blank.sourceText),
              blanks: question.blanks.filter((item) => item.id !== blank.id),
            })}
            variant="quiet"
          >×</Button>
        </div>
      ))}
    </div>
  );
}

function ShortAnswerFields({ locale, onChange, question }: {
  locale: AdminLocale;
  onChange: (question: ManualShortAnswerQuestionDraft) => void;
  question: ManualShortAnswerQuestionDraft;
}) {
  const t = authoringCopy[locale];
  return (
    <div className="manualShortAnswerFields">
      <TextareaField
        id={`${question.key}Reference`}
        label={t.referenceAnswer}
        maxLength={20_000}
        onChange={(event) => onChange({ ...question, referenceAnswerMarkdown: event.currentTarget.value })}
        rows={5}
        value={question.referenceAnswerMarkdown}
      />
      <label className="fieldGroup">
        <span className="fieldLabel">{t.image}</span>
        <input
          accept="image/png,image/jpeg,image/webp"
          onChange={(event) => {
            const input = event.currentTarget;
            const file = event.currentTarget.files?.[0];
            if (!file) return;
            input.setCustomValidity("");
            void readPromptImage(file)
              .then((image) => onChange({ ...question, image }))
              .catch(() => {
                input.setCustomValidity(locale === "ja" ? "対応画像を1.5MB以下で選択してください。" : locale === "zh" ? "请选择不超过1.5MB的有效图片。" : "Choose a supported image no larger than 1.5 MB.");
                input.reportValidity();
              });
          }}
          type="file"
        />
      </label>
      {question.image ? (
        <div className="manualImagePreview">
          <img alt={question.image.alt} src={question.image.dataUrl} />
          <TextField
            id={`${question.key}ImageAlt`}
            label={t.imageAlt}
            maxLength={300}
            onChange={(event) => onChange({ ...question, image: { ...question.image!, alt: event.currentTarget.value } })}
            value={question.image.alt}
          />
          <Button onClick={() => {
            const { image: _image, ...next } = question;
            onChange(next);
          }} variant="quiet">{t.removeImage}</Button>
        </div>
      ) : null}
    </div>
  );
}

const ManualQuestionCard = memo(function ManualQuestionCard({
  index,
  isFirst,
  isLast,
  locale,
  onChange,
  onMove,
  onRemove,
  question,
}: ManualQuestionCardProps) {
  const t = authoringCopy[locale];
  return (
    <article className="manualQuestionCard">
      <header>
        <div><span>{String(index + 1).padStart(2, "0")}</span><strong>{t.questionType(question.type)}</strong></div>
        <div className="manualCardActions">
          <Button aria-label={t.moveUp} disabled={isFirst} onClick={() => onMove(question.key, -1)} variant="quiet">↑</Button>
          <Button aria-label={t.moveDown} disabled={isLast} onClick={() => onMove(question.key, 1)} variant="quiet">↓</Button>
          <Button onClick={() => onRemove(question.key)} variant="quiet">{t.remove}</Button>
        </div>
      </header>
      {question.type !== "fill_blank" ? (
        <TextareaField
          id={`${question.key}Prompt`}
          label={t.prompt}
          maxLength={20_000}
          onChange={(event) => onChange({ ...question, promptMarkdown: event.currentTarget.value })}
          rows={4}
          value={question.promptMarkdown}
        />
      ) : null}
      {question.type === "single_choice" || question.type === "multiple_choice"
        ? <ChoiceQuestionFields locale={locale} onChange={onChange} question={question} />
        : null}
      {question.type === "fill_blank" ? <FillBlankQuestionFields locale={locale} onChange={onChange} question={question} /> : null}
      {question.type === "short_answer" ? <ShortAnswerFields locale={locale} onChange={onChange} question={question} /> : null}
    </article>
  );
});

export function ManualAuthoringEditor({ draft, locale, onAdd, onChange, onMove, onPaperRuleChange, onRemove }: ManualAuthoringEditorProps) {
  const t = authoringCopy[locale];
  const types = ["single_choice", "multiple_choice", "fill_blank", "short_answer"] as const;
  const paperSize = draft.paperRule.strategy === "random_subset"
    ? draft.paperRule.questionCount
    : draft.questions.length;
  return (
    <section aria-labelledby="manualAuthoringTitle" className="manualAuthoringSection">
      <header className="authoringSectionHeader">
        <div><h3 id="manualAuthoringTitle">{t.manualQuestions}</h3><span>{draft.questions.length}</span></div>
        <details className="manualAddMenu">
          <summary className="uiButton uiButtonPrimary">{t.addQuestion}</summary>
          <div>
            {types.map((type) => (
              <button key={type} onClick={(event) => {
                onAdd(type);
                event.currentTarget.closest("details")?.removeAttribute("open");
              }} type="button">{t.questionType(type)}</button>
            ))}
          </div>
        </details>
      </header>
      <div className="manualPaperRule">
        <fieldset>
          <legend>{t.paperStrategy}</legend>
          <label>
            <input
              checked={draft.paperRule.strategy === "all_questions"}
              name="manualPaperStrategy"
              onChange={() => onPaperRuleChange({ strategy: "all_questions" })}
              type="radio"
            />
            <span><strong>{t.allQuestions}</strong><small>{t.allQuestionsDescription}</small></span>
          </label>
          <label>
            <input
              checked={draft.paperRule.strategy === "random_subset"}
              name="manualPaperStrategy"
              onChange={() => onPaperRuleChange({
                strategy: "random_subset",
                questionCount: Math.max(1, draft.questions.length),
              })}
              type="radio"
            />
            <span><strong>{t.randomSubset}</strong><small>{t.randomSubsetDescription}</small></span>
          </label>
        </fieldset>
        {draft.paperRule.strategy === "random_subset" ? (
          <TextField
            {...(draft.paperRule.questionCount > draft.questions.length ? { error: t.paperCountExceedsBank } : {})}
            id="manualPublishedQuestionCount"
            inputMode="numeric"
            label={t.publishedQuestionCount}
            max={Math.max(1, draft.questions.length)}
            min={1}
            onChange={(event) => onPaperRuleChange({
              strategy: "random_subset",
              questionCount: Number.parseInt(event.currentTarget.value, 10) || 1,
            })}
            step={1}
            type="number"
            value={draft.paperRule.questionCount}
          />
        ) : null}
        <p>{t.questionBankSummary(draft.questions.length, paperSize)}</p>
      </div>
      {draft.questions.length === 0 ? <p className="manualEmptyState">{t.emptyQuestions}</p> : (
        <div className="manualQuestionList">
          {draft.questions.map((question, index) => (
            <ManualQuestionCard
              index={index}
              isFirst={index === 0}
              isLast={index === draft.questions.length - 1}
              key={question.key}
              locale={locale}
              onChange={onChange}
              onMove={onMove}
              onRemove={onRemove}
              question={question}
            />
          ))}
        </div>
      )}
    </section>
  );
}
