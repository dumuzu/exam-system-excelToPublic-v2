import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { adminSessionQueryOptions } from "../../features/auth/api/authQueries.ts";
import { useLogoutMutation } from "../../features/auth/hooks/useLogoutMutation.ts";
import type { AdminNavigationItem, AdminPermission, AdminSession, WorkspaceSubject } from "../../../types/contracts/admin-auth.ts";
import { useAdminUiStore } from "../state/adminUiStore.ts";
import { useAdminLocale, type AdminLocale } from "../../shared/i18n/AdminLocaleProvider.tsx";
import { AdminLocaleSelect } from "../../shared/i18n/AdminLocaleSelect.tsx";
import { getLocalizedSubjectName } from "../../shared/i18n/subjectNames.ts";
import { AsyncButton } from "../../shared/patterns/AsyncButton.tsx";
import { SelectField } from "../../shared/ui/SelectField.tsx";

const navigationLabels: Record<AdminNavigationItem["key"], Record<AdminLocale, string>> = {
  system: { ja: "システム", zh: "系统管理", en: "System" },
  subjects: { ja: "科目管理", zh: "科目管理", en: "Subjects" },
  dashboard: { ja: "教員ホーム", zh: "教师工作台", en: "Teacher home" },
  compose: { ja: "出題管理", zh: "出题管理", en: "Authoring" },
  rooms: { ja: "考場管理", zh: "考场管理", en: "Exam rooms" },
  results: { ja: "成績管理", zh: "成绩管理", en: "Results" },
  accounts: { ja: "アカウント", zh: "账户管理", en: "Accounts" },
};

const navigationMarkers: Record<AdminNavigationItem["key"], Record<AdminLocale, string>> = {
  system: { ja: "管", zh: "系", en: "S" },
  subjects: { ja: "科", zh: "科", en: "C" },
  dashboard: { ja: "教", zh: "教", en: "H" },
  compose: { ja: "出", zh: "题", en: "A" },
  rooms: { ja: "場", zh: "场", en: "R" },
  results: { ja: "成", zh: "绩", en: "G" },
  accounts: { ja: "帳", zh: "账", en: "U" },
};

const shellLabels: Record<AdminLocale, { brand: string; mark: string; subject: string; noSubject: string; navigation: string; skip: string }> = {
  ja: { brand: "試験管理システム", mark: "試", subject: "担当科目", noSubject: "科目未割当", navigation: "管理ナビゲーション", skip: "メインコンテンツへ移動" },
  zh: { brand: "考试管理系统", mark: "考", subject: "当前科目", noSubject: "未分配科目", navigation: "管理导航", skip: "跳到主要内容" },
  en: { brand: "Exam Management", mark: "E", subject: "Current subject", noSubject: "No subject assigned", navigation: "Administration navigation", skip: "Skip to main content" },
};

const roleLabels: Record<string, Record<AdminLocale, string>> = {
  super_admin: { ja: "スーパー管理者", zh: "超级管理员", en: "Super administrator" },
  test_admin: { ja: "テスト管理者", zh: "测试管理员", en: "Test administrator" },
  teacher: { ja: "教員", zh: "教师", en: "Teacher" },
  subject_admin: { ja: "科目管理者", zh: "科目管理员", en: "Subject administrator" },
  assistant_teacher: { ja: "補助教員", zh: "助教", en: "Assistant teacher" },
  proctor: { ja: "監督者", zh: "监考员", en: "Proctor" },
};

function NavigationLink({ active, item, label, marker, subjectId }: {
  active: boolean;
  item: AdminNavigationItem;
  label: string;
  marker: string;
  subjectId: string | null;
}) {
  const className = active ? "navigationItem navigationItemActive" : "navigationItem";
  const content = (
    <>
      <span aria-hidden="true" className="navigationMarker">{marker}</span>
      <span className="navigationLabel">{label}</span>
    </>
  );
  const search = { subjectId: subjectId ?? undefined };

  if (item.key === "dashboard") {
    return (
      <Link aria-current={active ? "page" : undefined} className={className} search={search} title={label} to="/dashboard">
        {content}
      </Link>
    );
  }
  if (item.key === "system") {
    return <Link aria-current={active ? "page" : undefined} className={className} title={label} to="/system">{content}</Link>;
  }
  if (item.key === "subjects") {
    return <Link aria-current={active ? "page" : undefined} className={className} title={label} to="/subjects">{content}</Link>;
  }
  if (item.key === "accounts") {
    return <Link aria-current={active ? "page" : undefined} className={className} search={{}} title={label} to="/accounts">{content}</Link>;
  }
  if (item.key === "rooms") {
    return <Link aria-current={active ? "page" : undefined} className={className} search={search} title={label} to="/exams">{content}</Link>;
  }
  if (item.key === "results") {
    return <Link aria-current={active ? "page" : undefined} className={className} search={search} title={label} to="/results">{content}</Link>;
  }
  if (item.key === "compose") {
    return <Link aria-current={active ? "page" : undefined} className={className} search={{ ...search, assessmentTypeKey: undefined }} title={label} to="/exams/new">{content}</Link>;
  }
  const unhandledNavigationKey: never = item.key;
  return unhandledNavigationKey;
}

export function AdminShell({ activeNavigationKey, children, session, subject, onSubjectChange, workspaceLabel, workspacePermissions }: {
  activeNavigationKey: AdminNavigationItem["key"];
  children: ReactNode;
  session: AdminSession;
  subject?: WorkspaceSubject | null;
  onSubjectChange?: (subjectId: string) => void;
  workspacePermissions?: readonly AdminPermission[];
  workspaceLabel?: string;
}) {
  const { locale } = useAdminLocale();
  const logout = useLogoutMutation();
  const sessionQuery = useQuery({
    ...adminSessionQueryOptions(),
    refetchOnWindowFocus: "always",
  });
  const sidebarCollapsed = useAdminUiStore((state) => state.sidebarCollapsed);
  const toggleSidebar = useAdminUiStore((state) => state.toggleSidebar);
  const displaySubjects = sessionQuery.data?.workspaceSubjects ?? session.workspaceSubjects;
  const grantedPermissions = workspacePermissions ?? subject?.permissions ?? [];
  const navigation = session.navigation.filter((item) => (
    item.workspace === "system"
    || item.permission === null
    || grantedPermissions.includes(item.permission)
  ));
  const role = session.role === "teacher" && subject ? subject.subjectRole : session.role;
  const t = shellLabels[locale];
  const collapseLabel = sidebarCollapsed
    ? (locale === "ja" ? "ナビゲーションを展開" : locale === "zh" ? "展开导航" : "Expand navigation")
    : (locale === "ja" ? "ナビゲーションを折りたたむ" : locale === "zh" ? "收起导航" : "Collapse navigation");

  const handleLogout = () => {
    logout.mutate(session.csrfToken, {
      onSettled: () => globalThis.location.assign("/admin/login/"),
    });
  };

  return (
    <div className="adminAppShell" data-sidebar-collapsed={sidebarCollapsed || undefined} data-workspace-kind={session.workspaceKind}>
      <a className="skipLink" href="#adminMainContent">{t.skip}</a>
      <aside className="adminSidebar">
        <div className="appBrandRow">
          <a className="appBrand" href={session.landingPath}>
            <span aria-hidden="true" className="appBrandMark">{t.mark}</span>
            <strong>{t.brand}</strong>
          </a>
          <button
            aria-controls="adminNavigation"
            aria-expanded={!sidebarCollapsed}
            aria-label={collapseLabel}
            className="sidebarToggle"
            onClick={toggleSidebar}
            title={collapseLabel}
            type="button"
          >
            <span aria-hidden="true">{sidebarCollapsed ? "›" : "‹"}</span>
          </button>
        </div>
        <nav aria-label={t.navigation} className="appNavigation" id="adminNavigation">
          {navigation.map((item) => (
            <NavigationLink
              active={item.key === activeNavigationKey}
              item={item}
              key={item.key}
              label={navigationLabels[item.key][locale]}
              marker={navigationMarkers[item.key][locale]}
              subjectId={subject?.id ?? null}
            />
          ))}
        </nav>
      </aside>

      <div className="adminMain">
        <header className="utilityBar">
          <div className="subjectUtility">
            {workspaceLabel ? <span className="workspaceContext">{workspaceLabel}</span> : displaySubjects.length > 0 ? (
              <SelectField
                disabled={displaySubjects.length < 2}
                id="subjectSelector"
                label={t.subject}
                onChange={(event) => onSubjectChange?.(event.currentTarget.value)}
                options={displaySubjects.map((item) => ({
                  label: getLocalizedSubjectName(item, locale),
                  value: item.id,
                }))}
                value={subject?.id ?? displaySubjects[0]?.id ?? ""}
              />
            ) : <span className="noSubjectLabel">{t.noSubject}</span>}
          </div>
          <div className="userUtility">
            <AdminLocaleSelect />
            <span className="userIdentity"><small>{roleLabels[role]?.[locale] ?? role}</small><strong>{session.user}</strong></span>
            <AsyncButton onClick={handleLogout} pending={logout.isPending} pendingLabel={locale === "ja" ? "処理中…" : locale === "zh" ? "处理中…" : "Signing out…"} variant="quiet">
              {locale === "ja" ? "ログアウト" : locale === "zh" ? "退出" : "Sign out"}
            </AsyncButton>
          </div>
        </header>
        <main className="adminContent" id="adminMainContent" tabIndex={-1}>{children}</main>
      </div>
    </div>
  );
}
