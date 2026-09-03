import { createLazyRoute } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";

import { ApiRequestError } from "../../../shared/api/httpClient.ts";
import { useAdminLocale } from "../../../shared/i18n/AdminLocaleProvider.tsx";
import { AsyncButton } from "../../../shared/patterns/AsyncButton.tsx";
import { InlineFeedback } from "../../../shared/patterns/PageStates.tsx";
import { TextField } from "../../../shared/ui/TextField.tsx";
import { useLoginMutation } from "../hooks/useLoginMutation.ts";

export const Route = createLazyRoute("/login")({ component: LoginPage });

const copy = {
  ja: {
    formLabel: "管理者ログイン",
    account: "アカウント",
    password: "パスワード",
    submit: "入る",
    submitting: "確認中…",
    invalid: "アカウントまたはパスワードが正しくありません。",
    unavailable: "管理者認証は現在利用できません。",
    limited: "試行回数が多すぎます。しばらく待ってから再試行してください。",
    generic: "ログイン処理に失敗しました。もう一度お試しください。",
  },
  zh: {
    formLabel: "管理员登录",
    account: "账户名",
    password: "密码",
    submit: "进入",
    submitting: "正在验证…",
    invalid: "账户或密码不正确。",
    unavailable: "管理员认证当前不可用。",
    limited: "尝试次数过多，请稍后再试。",
    generic: "登录失败，请重新尝试。",
  },
  en: {
    formLabel: "Administrator sign in", account: "Account", password: "Password", submit: "Continue", submitting: "Checking…",
    invalid: "The account name or password is incorrect.", unavailable: "Administrator authentication is currently unavailable.",
    limited: "Too many attempts. Wait a moment and try again.", generic: "Sign in failed. Please try again.",
  },
} as const;

function loginErrorMessage(error: unknown, locale: keyof typeof copy): string {
  const t = copy[locale];
  if (!(error instanceof ApiRequestError)) return t.generic;
  if (error.status === 401) return t.invalid;
  if (error.status === 429) return t.limited;
  if (error.status === 503) return t.unavailable;
  return t.generic;
}

function LoginPage() {
  const { locale } = useAdminLocale();
  const login = useLoginMutation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const t = copy[locale];

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    login.mutate({ username, password }, {
      onSuccess: ({ landingPath }) => {
        setPassword("");
        globalThis.location.assign(landingPath);
      },
    });
  };

  return (
    <main className="loginLayout">
      <form aria-label={t.formLabel} className="loginForm" onSubmit={handleSubmit}>
        <div className="loginFields">
          <TextField
            autoComplete="username"
            id="loginUsername"
            label={t.account}
            name="username"
            onChange={(event) => setUsername(event.currentTarget.value)}
            required
            value={username}
          />
          <TextField
            autoComplete="current-password"
            id="loginPassword"
            label={t.password}
            name="password"
            onChange={(event) => setPassword(event.currentTarget.value)}
            required
            type="password"
            value={password}
          />
        </div>
        {login.isError ? <InlineFeedback tone="error">{loginErrorMessage(login.error, locale)}</InlineFeedback> : null}
        <AsyncButton
          className="loginSubmit"
          pending={login.isPending}
          pendingLabel={t.submitting}
          type="submit"
          variant="primary"
        >
          {t.submit}
        </AsyncButton>
      </form>
    </main>
  );
}
