import { useEffect, useId, useRef, useState, type FormEvent } from "react";

import { ApiRequestError } from "../../../shared/api/httpClient.ts";
import type { AdminLocale } from "../../../shared/i18n/AdminLocaleProvider.tsx";
import { AsyncButton } from "../../../shared/patterns/AsyncButton.tsx";
import { InlineFeedback } from "../../../shared/patterns/PageStates.tsx";
import { Button } from "../../../shared/ui/Button.tsx";
import { SelectField } from "../../../shared/ui/SelectField.tsx";
import { TextField } from "../../../shared/ui/TextField.tsx";
import { useCreateAccountMutation } from "../hooks/useAccountMutations.ts";
import type { ManagedPlatformRole } from "../../../../types/contracts/account-administration.ts";

const usernamePattern = /^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/;

const copy = {
  ja: {
    title: "アカウントを追加",
    description: "教員本人に渡す初期ログイン情報を登録します。",
    username: "ログイン名",
    usernameHint: "半角英数字で始め、3〜64文字。ピリオド、ハイフン、下線を使用できます。",
    displayName: "表示名",
    password: "初期パスワード",
    passwordHint: "12〜200文字。登録後、この画面には再表示されません。",
    role: "プラットフォーム権限",
    teacher: "教員",
    superAdmin: "スーパー管理者",
    cancel: "キャンセル",
    submit: "作成",
    pending: "作成中…",
    invalid: "入力内容を確認してください。",
    duplicate: "同じログイン名のアカウントがすでに存在します。",
    failed: "アカウントを作成できませんでした。",
  },
  zh: {
    title: "新增账户",
    description: "登记需要安全交给教师本人的初始登录信息。",
    username: "登录名",
    usernameHint: "以半角字母或数字开头，共 3–64 位，可使用点、短横线和下划线。",
    displayName: "显示姓名",
    password: "初始密码",
    passwordHint: "长度 12–200 位；提交后系统不会再次显示。",
    role: "平台权限",
    teacher: "教师",
    superAdmin: "超级管理员",
    cancel: "取消",
    submit: "创建",
    pending: "创建中…",
    invalid: "请检查输入内容。",
    duplicate: "该登录名已经存在。",
    failed: "无法创建账户。",
  },
  en: {
    title: "Add account", description: "Register the initial sign-in details that will be delivered securely to the teacher.",
    username: "Login name", usernameHint: "3–64 characters, beginning with a letter or number. Periods, hyphens, and underscores are allowed.",
    displayName: "Display name", password: "Initial password", passwordHint: "12–200 characters. It will not be displayed again after submission.",
    role: "Platform role", teacher: "Teacher", superAdmin: "Super administrator",
    cancel: "Cancel", submit: "Create", pending: "Creating…",
    invalid: "Check the form fields.", duplicate: "An account with this login name already exists.", failed: "The account could not be created.",
  },
} as const;

function errorMessage(error: unknown, locale: AdminLocale): string {
  if (error instanceof ApiRequestError && error.code === "ACCOUNT_USERNAME_EXISTS") return copy[locale].duplicate;
  return copy[locale].failed;
}

export function CreateAccountDialog({ csrfToken, locale, onClose, onComplete }: {
  csrfToken: string;
  locale: AdminLocale;
  onClose: () => void;
  onComplete: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const [validationError, setValidationError] = useState("");
  const mutation = useCreateAccountMutation();
  const t = copy[locale];

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, []);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const username = String(values.get("username") ?? "").normalize("NFKC").trim().toLowerCase();
    const displayName = String(values.get("displayName") ?? "").normalize("NFKC").trim();
    const password = String(values.get("password") ?? "");
    const platformRole = String(values.get("platformRole") ?? "teacher") as ManagedPlatformRole;
    const passwordInput = form.elements.namedItem("password");

    if (!usernamePattern.test(username) || displayName.length < 1 || displayName.length > 100
      || password.length < 12 || password.length > 200
      || (platformRole !== "teacher" && platformRole !== "super_admin")) {
      setValidationError(t.invalid);
      return;
    }

    if (passwordInput instanceof HTMLInputElement) passwordInput.value = "";
    setValidationError("");
    mutation.mutate({ username, displayName, password, platformRole, confirmed: true, csrfToken }, {
      onSuccess: () => onComplete(),
    });
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
          <h2 id={titleId}>{t.title}</h2>
          <p id={descriptionId}>{t.description}</p>
        </header>
        <div className="accountDialogFields">
          <TextField autoComplete="off" autoFocus hint={t.usernameHint} id="newAccountUsername" label={t.username} maxLength={64} minLength={3} name="username" required />
          <TextField autoComplete="name" id="newAccountDisplayName" label={t.displayName} maxLength={100} name="displayName" required />
          <TextField autoComplete="new-password" hint={t.passwordHint} id="newAccountPassword" label={t.password} maxLength={200} minLength={12} name="password" required type="password" />
          <SelectField id="newAccountRole" label={t.role} name="platformRole" options={[
            { label: t.teacher, value: "teacher" },
            { label: t.superAdmin, value: "super_admin" },
          ]} />
        </div>
        {validationError ? <InlineFeedback tone="error">{validationError}</InlineFeedback> : null}
        {mutation.isError ? <InlineFeedback tone="error">{errorMessage(mutation.error, locale)}</InlineFeedback> : null}
        <footer className="accountDialogActions">
          <Button disabled={mutation.isPending} onClick={onClose} variant="secondary">{t.cancel}</Button>
          <AsyncButton pending={mutation.isPending} pendingLabel={t.pending} type="submit" variant="primary">{t.submit}</AsyncButton>
        </footer>
      </form>
    </dialog>
  );
}
