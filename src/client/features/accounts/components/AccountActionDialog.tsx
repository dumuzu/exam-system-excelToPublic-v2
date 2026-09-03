import { useEffect, useId, useRef, useState, type FormEvent } from "react";

import { ApiRequestError } from "../../../shared/api/httpClient.ts";
import type { AdminLocale } from "../../../shared/i18n/AdminLocaleProvider.tsx";
import { getLocalizedSubjectName } from "../../../shared/i18n/subjectNames.ts";
import { AsyncButton } from "../../../shared/patterns/AsyncButton.tsx";
import { InlineFeedback } from "../../../shared/patterns/PageStates.tsx";
import { Button } from "../../../shared/ui/Button.tsx";
import { SelectField } from "../../../shared/ui/SelectField.tsx";
import { TextField } from "../../../shared/ui/TextField.tsx";
import { useAccountActionMutation } from "../hooks/useAccountMutations.ts";
import type { AccountActionTarget } from "./AccountTable.tsx";
import type { ManagedSubject, ManagedSubjectRole } from "../../../../types/contracts/account-administration.ts";
import type { AccountActionInput } from "../types.ts";

const copy = {
  ja: {
    membershipTitle: "担当科目を割り当て",
    membershipDescription: "選択した科目へのアクセス権を追加または更新します。既存セッションは更新後に無効になります。",
    passwordTitle: "パスワードを再設定",
    passwordDescription: "現在のパスワードを無効にし、対象アカウントの全セッションを終了します。",
    disableTitle: "アカウントを無効化",
    disableDescription: "対象者は直ちにログインできなくなり、現在のセッションも無効になります。",
    enableTitle: "アカウントを有効化",
    enableDescription: "対象者が再びログインできるようにします。",
    promoteTitle: "スーパー管理者へ変更",
    promoteDescription: "全科目のシステム管理権限を付与し、現在のセッションを無効にします。",
    demoteTitle: "教員へ変更",
    demoteDescription: "システム管理権限を削除し、現在のセッションを無効にします。担当科目は保持されます。",
    subject: "科目",
    availableSubjects: "追加する科目",
    assigned: "割当済み",
    noAvailableSubjects: "このアカウントには、すべての科目が割り当てられています。",
    selectAtLeastOne: "追加する科目を1つ以上選択してください。",
    subjectRole: "科目権限",
    teacher: "教員",
    subject_admin: "科目管理者",
    proctor: "監督者",
    password: "新しいパスワード",
    passwordHint: "12〜200文字。画面には再表示されません。",
    cancel: "キャンセル",
    confirm: "変更を確定",
    pending: "更新中…",
    invalid: "入力内容を確認してください。",
    lastSuper: "有効なスーパー管理者を少なくとも1名残す必要があります。",
    failed: "アカウント情報を更新できませんでした。",
  },
  zh: {
    membershipTitle: "分配负责科目",
    membershipDescription: "新增或更新所选科目的访问权限；更新后旧会话会立即失效。",
    passwordTitle: "重置密码",
    passwordDescription: "当前密码会立即失效，并结束该账户的全部现有会话。",
    disableTitle: "停用账户",
    disableDescription: "该账户将立即无法登录，当前会话也会失效。",
    enableTitle: "启用账户",
    enableDescription: "恢复该账户的登录权限。",
    promoteTitle: "设为超级管理员",
    promoteDescription: "授予全科目的系统管理权限，并使当前会话失效。",
    demoteTitle: "设为普通教师",
    demoteDescription: "移除系统管理权限并使当前会话失效，已有科目分配会保留。",
    subject: "科目",
    availableSubjects: "选择要添加的科目",
    assigned: "已分配",
    noAvailableSubjects: "该账户已经分配了全部科目。",
    selectAtLeastOne: "请至少选择一个要添加的科目。",
    subjectRole: "科目权限",
    teacher: "教师",
    subject_admin: "科目管理员",
    proctor: "监考员",
    password: "新密码",
    passwordHint: "长度 12–200 位，提交后不会再次显示。",
    cancel: "取消",
    confirm: "确认变更",
    pending: "更新中…",
    invalid: "请检查输入内容。",
    lastSuper: "系统必须至少保留一个启用的超级管理员。",
    failed: "无法更新账户信息。",
  },
  en: {
    membershipTitle: "Assign subjects",
    membershipDescription: "Add access to several subjects in one update. Existing assignments are preserved, and current sessions are invalidated.",
    passwordTitle: "Reset password",
    passwordDescription: "Replace the current password and end every active session for this account.",
    disableTitle: "Disable account",
    disableDescription: "The account will no longer be able to sign in, and its current sessions will end.",
    enableTitle: "Enable account",
    enableDescription: "Allow this account to sign in again.",
    promoteTitle: "Make super administrator",
    promoteDescription: "Grant system-wide administration rights and invalidate current sessions.",
    demoteTitle: "Make teacher",
    demoteDescription: "Remove system administration rights and invalidate current sessions. Subject assignments are preserved.",
    subject: "Subject",
    availableSubjects: "Subjects to add",
    assigned: "Assigned",
    noAvailableSubjects: "Every subject is already assigned to this account.",
    selectAtLeastOne: "Select at least one subject to add.",
    subjectRole: "Subject role",
    teacher: "Teacher",
    subject_admin: "Subject administrator",
    proctor: "Proctor",
    password: "New password",
    passwordHint: "12–200 characters. It will not be shown again.",
    cancel: "Cancel",
    confirm: "Confirm change",
    pending: "Updating…",
    invalid: "Check the form values.",
    lastSuper: "At least one active super administrator must remain.",
    failed: "The account could not be updated.",
  },
} as const;

function actionPresentation(target: AccountActionTarget, locale: AdminLocale) {
  const t = copy[locale];
  if (target.action === "membership") return { title: t.membershipTitle, description: t.membershipDescription, danger: false };
  if (target.action === "password") return { title: t.passwordTitle, description: t.passwordDescription, danger: true };
  if (target.action === "status") return target.account.status === "disabled"
    ? { title: t.enableTitle, description: t.enableDescription, danger: false }
    : { title: t.disableTitle, description: t.disableDescription, danger: true };
  return target.account.platformRole === "super_admin"
    ? { title: t.demoteTitle, description: t.demoteDescription, danger: true }
    : { title: t.promoteTitle, description: t.promoteDescription, danger: true };
}
function actionError(error: unknown, locale: AdminLocale): string {
  if (error instanceof ApiRequestError && error.code === "LAST_ACTIVE_SUPER_ADMIN") return copy[locale].lastSuper;
  return copy[locale].failed;
}

export function AccountActionDialog({ csrfToken, locale, onClose, onComplete, subjects, target }: {
  csrfToken: string;
  locale: AdminLocale;
  onClose: () => void;
  onComplete: () => void;
  subjects: readonly ManagedSubject[];
  target: AccountActionTarget;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const [password, setPassword] = useState("");
  const assignedSubjectIds = new Set(target.account.memberships.map((membership) => membership.subjectId));
  const availableSubjects = subjects.filter((subject) => !assignedSubjectIds.has(subject.id));
  const [selectedSubjectIds, setSelectedSubjectIds] = useState<readonly string[]>([]);
  const [subjectRole, setSubjectRole] = useState<ManagedSubjectRole>("teacher");
  const [validationError, setValidationError] = useState("");
  const mutation = useAccountActionMutation();
  const t = copy[locale];
  const presentation = actionPresentation(target, locale);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, []);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const common = { accountId: target.account.id, confirmed: true as const, csrfToken };
    let input: AccountActionInput;
    if (target.action === "membership") {
      if (selectedSubjectIds.length === 0) { setValidationError(t.selectAtLeastOne); return; }
      input = {
        ...common,
        action: "membership",
        memberships: selectedSubjectIds.map((subjectId) => ({ subjectId, subjectRole })),
      };
    } else if (target.action === "password") {
      if (password.length < 12 || password.length > 200) { setValidationError(t.invalid); return; }
      input = { ...common, action: "password", password };
      setPassword("");
    } else if (target.action === "status") {
      input = { ...common, action: "status", status: target.account.status === "disabled" ? "active" : "disabled" };
    } else {
      input = { ...common, action: "role", platformRole: target.account.platformRole === "super_admin" ? "teacher" : "super_admin" };
    }
    setValidationError("");
    mutation.mutate(input, { onSuccess: () => onComplete() });
  };

  return (
    <dialog
      aria-describedby={descriptionId}
      aria-labelledby={titleId}
      className="accountDialog"
      onCancel={(event) => {
        event.preventDefault();
        if (!mutation.isPending) onClose();
      }}
      ref={dialogRef}
    >
      <form className="accountDialogForm" onSubmit={handleSubmit}>
        <header className="accountDialogHeader">
          <span className="accountDialogIdentity"><strong>{target.account.displayName}</strong><code>{target.account.username}</code></span>
          <h2 id={titleId}>{presentation.title}</h2>
          <p id={descriptionId}>{presentation.description}</p>
        </header>
        <div className="accountDialogFields">
          {target.action === "membership" ? (
            <div className="accountMembershipPicker">
              <fieldset>
                <legend>{t.availableSubjects}</legend>
                {availableSubjects.length > 0 ? (
                  <div className="accountMembershipOptions">
                    {availableSubjects.map((subject) => {
                      const checked = selectedSubjectIds.includes(subject.id);
                      return (
                        <label className="accountMembershipOption" key={subject.id}>
                          <input
                            checked={checked}
                            onChange={(event) => setSelectedSubjectIds((current) => event.currentTarget.checked
                              ? [...current, subject.id]
                              : current.filter((subjectId) => subjectId !== subject.id))}
                            type="checkbox"
                          />
                          <span><strong>{getLocalizedSubjectName(subject, locale)}</strong><code>{subject.code}</code></span>
                        </label>
                      );
                    })}
                  </div>
                ) : <p className="accountMembershipEmpty">{t.noAvailableSubjects}</p>}
              </fieldset>
              <SelectField id="accountSubjectRole" label={t.subjectRole} onChange={(event) => setSubjectRole(event.currentTarget.value as ManagedSubjectRole)} options={[
                { label: t.teacher, value: "teacher" },
                { label: t.subject_admin, value: "subject_admin" },
                { label: t.proctor, value: "proctor" },
              ]} value={subjectRole} />
            </div>
          ) : null}
          {target.action === "password" ? (
            <TextField autoComplete="new-password" autoFocus hint={t.passwordHint} id="replacementPassword" label={t.password} maxLength={200} minLength={12} onChange={(event) => setPassword(event.currentTarget.value)} required type="password" value={password} />
          ) : null}
        </div>
        {validationError ? <InlineFeedback tone="error">{validationError}</InlineFeedback> : null}
        {mutation.isError ? <InlineFeedback tone="error">{actionError(mutation.error, locale)}</InlineFeedback> : null}
        <footer className="accountDialogActions">
          <Button disabled={mutation.isPending} onClick={onClose} variant="secondary">{t.cancel}</Button>
          <AsyncButton disabled={target.action === "membership" && selectedSubjectIds.length === 0} pending={mutation.isPending} pendingLabel={t.pending} type="submit" variant={presentation.danger ? "danger" : "primary"}>{t.confirm}</AsyncButton>
        </footer>
      </form>
    </dialog>
  );
}
