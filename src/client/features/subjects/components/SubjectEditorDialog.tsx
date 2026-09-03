import { useEffect, useId, useRef, useState, type FormEvent } from "react";

import type {
  ManagedAssessmentTypeKey,
  ManagedSubject,
} from "../../../../types/contracts/account-administration.ts";
import type { StudentDisplayLocale } from "../../../../types/models/locale.ts";
import { ApiRequestError } from "../../../shared/api/httpClient.ts";
import type { AdminLocale } from "../../../shared/i18n/AdminLocaleProvider.tsx";
import { AsyncButton } from "../../../shared/patterns/AsyncButton.tsx";
import { InlineFeedback } from "../../../shared/patterns/PageStates.tsx";
import { Button } from "../../../shared/ui/Button.tsx";
import { SelectField } from "../../../shared/ui/SelectField.tsx";
import { TextField } from "../../../shared/ui/TextField.tsx";
import { useCreateSubjectMutation, useUpdateSubjectMutation } from "../hooks/useSubjectMutations.ts";

const copy = {
  ja: {
    createTitle: "科目を登録", editTitle: "科目設定", createDescription: "科目で利用できる出題機能を管理者が割り当てます。教員は割り当てられた機能だけを利用できます。", editDescription: "科目名、学生画面の言語、今後利用できる出題機能を変更します。過去の試験と採点データには影響しません。",
    code: "科目コード", codeHint: "半角英小文字・数字・ハイフン（例: business-japanese）", adapter: "利用できる出題機能", capabilityHint: "1つ以上選択してください。教員作成問題は科目を問わず利用できる共通機能です。", immutable: "科目コードは登録後に変更できません", excel: "Excel 数式", excelHint: "Excel ワークスペースで数式を解答する科目向け", manual: "教員作成問題", manualHint: "選択・穴埋め・記述問題を教員が作成する共通機能",
    nameJa: "日本語の科目名", nameZh: "中国語の科目名", nameEn: "英語の科目名", language: "学生画面の言語", legacy: "現行の日英表示", ja: "日本語", zh: "簡体字中国語", en: "英語",
    cancel: "キャンセル", create: "登録", save: "保存", creating: "登録中…", saving: "保存中…",
    invalid: "科目名、科目コード、出題機能を確認してください。", duplicate: "この科目コードはすでに使われています。", failed: "科目を保存できませんでした。",
  },
  zh: {
    createTitle: "登记科目", editTitle: "科目设置", createDescription: "由管理员为科目分配可用的出题能力，教师只能使用已分配的能力。", editDescription: "修改科目名称、学生端语言及今后可用的出题能力，不会改变已有考试与评分数据。",
    code: "科目代码", codeHint: "小写英文字母、数字和连字符（例如 business-japanese）", adapter: "可用出题能力", capabilityHint: "至少选择一项。教师自定义题目是所有科目均可复用的通用能力。", immutable: "科目代码登记后不可修改", excel: "Excel 公式", excelHint: "适用于在 Excel 工作区中作答公式的科目", manual: "教师自定义题目", manualHint: "教师编写单选、多选、填空和简答题的通用能力",
    nameJa: "日语科目名", nameZh: "中文科目名", nameEn: "英语科目名", language: "学生端界面语言", legacy: "现有日英双语", ja: "日语", zh: "简体中文", en: "英语",
    cancel: "取消", create: "登记", save: "保存", creating: "登记中…", saving: "保存中…",
    invalid: "请检查科目名称、科目代码和出题能力。", duplicate: "该科目代码已被使用。", failed: "无法保存科目。",
  },
  en: {
    createTitle: "Register subject", editTitle: "Subject settings", createDescription: "Assign the authoring capabilities available to this subject. Teachers can use only the capabilities enabled here.", editDescription: "Update names, student language, and future authoring capabilities without changing existing exams or results.",
    code: "Subject code", codeHint: "Lowercase letters, numbers, and hyphens (for example, business-japanese)", adapter: "Available authoring capabilities", capabilityHint: "Select at least one. Teacher-authored questions are reusable across subjects.", immutable: "The subject code cannot be changed after registration", excel: "Excel formulas", excelHint: "For subjects answered with formulas in the Excel workspace", manual: "Teacher-authored questions", manualHint: "Reusable single-choice, multiple-choice, fill-in, and short-answer authoring",
    nameJa: "Japanese subject name", nameZh: "Chinese subject name", nameEn: "English subject name", language: "Student interface language", legacy: "Current Japanese and English", ja: "Japanese", zh: "Simplified Chinese", en: "English",
    cancel: "Cancel", create: "Register", save: "Save", creating: "Registering…", saving: "Saving…",
    invalid: "Check the subject names, code, and authoring capabilities.", duplicate: "That subject code is already in use.", failed: "The subject could not be saved.",
  },
} as const;

export function SubjectEditorDialog({ csrfToken, locale, onClose, onComplete, subject }: {
  csrfToken: string;
  locale: AdminLocale;
  onClose: () => void;
  onComplete: () => void;
  subject?: ManagedSubject | null;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const [code, setCode] = useState(subject?.code ?? "");
  const [assessmentTypeKeys, setAssessmentTypeKeys] = useState<ManagedAssessmentTypeKey[]>(
    subject ? [...subject.assessmentTypeKeys] : ["manual_questions"],
  );
  const [nameJa, setNameJa] = useState(subject?.nameJa ?? "");
  const [nameZh, setNameZh] = useState(subject?.nameZh ?? "");
  const [nameEn, setNameEn] = useState(subject?.nameEn ?? "");
  const [studentLocale, setStudentLocale] = useState<StudentDisplayLocale>(subject?.studentLocale ?? "ja");
  const [validationError, setValidationError] = useState("");
  const createMutation = useCreateSubjectMutation();
  const updateMutation = useUpdateSubjectMutation();
  const mutation = subject ? updateMutation : createMutation;
  const t = copy[locale];
  const normalizedCode = code.normalize("NFKC").trim().toLowerCase();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => { if (dialog?.open) dialog.close(); };
  }, []);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if ((!subject && !normalizedCode) || !nameJa.trim() || !nameZh.trim() || !nameEn.trim() || assessmentTypeKeys.length === 0) {
      setValidationError(t.invalid);
      return;
    }
    setValidationError("");
    if (subject) {
      updateMutation.mutate({ csrfToken, subjectId: subject.id, assessmentTypeKeys, nameJa, nameZh, nameEn, studentLocale }, { onSuccess: onComplete });
      return;
    }
    createMutation.mutate({ csrfToken, code, assessmentTypeKeys, nameJa, nameZh, nameEn, studentLocale }, { onSuccess: onComplete });
  };

  const errorMessage = mutation.error instanceof ApiRequestError
    ? mutation.error.code === "SUBJECT_CODE_EXISTS" ? t.duplicate : mutation.error.message
    : t.failed;

  return (
    <dialog aria-describedby={descriptionId} aria-labelledby={titleId} className="subjectEditorDialog" onCancel={(event) => {
      event.preventDefault();
      if (!mutation.isPending) onClose();
    }} ref={dialogRef}>
      <form className="subjectEditorForm" onSubmit={handleSubmit}>
        <header className="subjectEditorHeader">
          <code>{subject?.code ?? "NEW SUBJECT"}</code>
          <h2 id={titleId}>{subject ? t.editTitle : t.createTitle}</h2>
          <p id={descriptionId}>{subject ? t.editDescription : t.createDescription}</p>
        </header>
        <div className="subjectEditorFields">
          {subject ? (
            <div className="subjectImmutableFields">
              <span><small>{t.code}</small><strong>{subject.code}</strong></span>
              <p>{t.immutable}</p>
            </div>
          ) : (
            <TextField autoComplete="off" hint={t.codeHint} id="subjectCode" label={t.code} maxLength={64} onChange={(event) => setCode(event.currentTarget.value)} pattern="[a-z0-9][a-z0-9-]{1,63}" required value={code} />
          )}
          <fieldset className="subjectCapabilityFieldset">
            <legend>{t.adapter}</legend>
            <p>{t.capabilityHint}</p>
            <div className="subjectCapabilityOptions">
              {([
                { description: t.manualHint, key: "manual_questions", label: t.manual },
                { description: t.excelHint, key: "excel_formula", label: t.excel },
              ] as const).map((capability) => (
                <label className="subjectCapabilityOption" key={capability.key}>
                  <input
                    checked={assessmentTypeKeys.includes(capability.key)}
                    onChange={(event) => {
                      const checked = event.currentTarget.checked;
                      setAssessmentTypeKeys((current) => checked
                        ? current.includes(capability.key) ? current : [...current, capability.key]
                        : current.filter((key) => key !== capability.key));
                    }}
                    type="checkbox"
                  />
                  <span><strong>{capability.label}</strong><small>{capability.description}</small></span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="subjectEditorNameGrid">
            <TextField id="subjectNameJa" label={t.nameJa} maxLength={100} onChange={(event) => setNameJa(event.currentTarget.value)} required value={nameJa} />
            <TextField id="subjectNameZh" label={t.nameZh} maxLength={100} onChange={(event) => setNameZh(event.currentTarget.value)} required value={nameZh} />
            <TextField id="subjectNameEn" label={t.nameEn} maxLength={100} onChange={(event) => setNameEn(event.currentTarget.value)} required value={nameEn} />
          </div>
          <SelectField id="subjectStudentLocale" label={t.language} onChange={(event) => setStudentLocale(event.currentTarget.value as StudentDisplayLocale)} options={[
            { label: t.legacy, value: "legacy_bilingual" }, { label: t.ja, value: "ja" }, { label: t.zh, value: "zh" }, { label: t.en, value: "en" },
          ]} value={studentLocale} />
        </div>
        {validationError ? <InlineFeedback tone="error">{validationError}</InlineFeedback> : null}
        {mutation.isError ? <InlineFeedback tone="error">{errorMessage}</InlineFeedback> : null}
        <footer className="subjectEditorActions">
          <Button disabled={mutation.isPending} onClick={onClose} variant="secondary">{t.cancel}</Button>
          <AsyncButton disabled={assessmentTypeKeys.length === 0} pending={mutation.isPending} pendingLabel={subject ? t.saving : t.creating} type="submit">{subject ? t.save : t.create}</AsyncButton>
        </footer>
      </form>
    </dialog>
  );
}
