import { Link, createLazyRoute } from "@tanstack/react-router";
import { useMemo } from "react";

import { AdminShell } from "../../../app/layouts/AdminShell.tsx";
import { useAdminLocale } from "../../../shared/i18n/AdminLocaleProvider.tsx";
import { getLocalizedSubjectName } from "../../../shared/i18n/subjectNames.ts";
import { EmptyState, PageSkeleton, QueryErrorState } from "../../../shared/patterns/PageStates.tsx";
import { Button } from "../../../shared/ui/Button.tsx";
import { RecentSystemExams } from "../components/RecentSystemExams.tsx";
import { SubjectOperationsTable, type SubjectOperationsRow } from "../components/SubjectOperationsTable.tsx";
import { SystemMetricStrip } from "../components/SystemMetricStrip.tsx";
import { useSystemOverviewQueries } from "../hooks/useSystemOverviewQueries.ts";
import "../system.css";

export const Route = createLazyRoute("/system")({ component: SystemPage });

const copy = {
  ja: {
    workspace: "システム管理", title: "システム概要", description: "アカウント、科目、考場の現在の状態を確認できます。", metrics: "システム状態指標",
    accounts: "アカウント", subjects: "科目", activeRooms: "実施中の考場", submissions: "提出済み答案",
    actions: "管理入口", accountAction: "アカウントと権限", accountDescription: "教員アカウント、権限、担当科目を管理します。",
    subjectAction: "科目管理", subjectDescription: "科目の登録、表示言語、運用状態を管理します。",
    subjectsTitle: "科目別の状態", recentTitle: "最近の試験", refresh: "更新", refreshing: "更新中…",
    error: "システム概要を読み込めません", errorDescription: "通信状態を確認して、もう一度お試しください。", retry: "再試行",
    emptySubjects: "科目がありません", emptySubjectsDescription: "科目を登録すると、ここに表示されます。",
    emptyExams: "最近の試験はありません", emptyExamsDescription: "教員が試験を作成すると、ここに表示されます。", manageSubjects: "科目を管理",
  },
  zh: {
    workspace: "系统管理", title: "系统概览", description: "查看账户、科目与考场的当前状态。", metrics: "系统状态指标",
    accounts: "账户", subjects: "科目", activeRooms: "进行中的考场", submissions: "已提交答卷",
    actions: "管理入口", accountAction: "账户与权限", accountDescription: "管理教师账户、平台权限和负责科目。",
    subjectAction: "科目管理", subjectDescription: "管理科目登记、显示语言和运行状态。",
    subjectsTitle: "各科目状态", recentTitle: "最近考试", refresh: "刷新", refreshing: "刷新中…",
    error: "无法加载系统概览", errorDescription: "请检查网络状态后重新尝试。", retry: "重试",
    emptySubjects: "暂无科目", emptySubjectsDescription: "登记科目后将在这里显示。",
    emptyExams: "暂无最近考试", emptyExamsDescription: "教师创建考试后将在这里显示。", manageSubjects: "管理科目",
  },
  en: {
    workspace: "System administration", title: "System overview", description: "Review the current state of accounts, subjects, and exam rooms.", metrics: "System status metrics",
    accounts: "Accounts", subjects: "Subjects", activeRooms: "Active exam rooms", submissions: "Submitted papers",
    actions: "Administration", accountAction: "Accounts and permissions", accountDescription: "Manage teacher accounts, platform roles, and subject assignments.",
    subjectAction: "Subject management", subjectDescription: "Manage subject registration, display languages, and operational status.",
    subjectsTitle: "Subject operations", recentTitle: "Recent exams", refresh: "Refresh", refreshing: "Refreshing…",
    error: "System overview could not be loaded", errorDescription: "Check the connection and try again.", retry: "Try again",
    emptySubjects: "No subjects", emptySubjectsDescription: "Subjects will appear here after they are registered.",
    emptyExams: "No recent exams", emptyExamsDescription: "Teacher-created exams will appear here.", manageSubjects: "Manage subjects",
  },
} as const;

function SystemPage() {
  const { locale } = useAdminLocale();
  const { session } = Route.useLoaderData();
  const queries = useSystemOverviewQueries();
  const t = copy[locale];
  const { exams, subjects } = queries;

  const overview = useMemo(() => {
    const counters = new Map<string, { eventCount: number; activeCount: number; submittedCount: number }>();
    let activeRooms = 0;
    let submissions = 0;
    for (const exam of exams) {
      const current = counters.get(exam.subjectId) ?? { eventCount: 0, activeCount: 0, submittedCount: 0 };
      current.eventCount += 1;
      current.activeCount += exam.state === "active" ? 1 : 0;
      current.submittedCount += exam.submittedCount;
      counters.set(exam.subjectId, current);
      activeRooms += exam.state === "active" ? 1 : 0;
      submissions += exam.submittedCount;
    }
    const subjectRows: SubjectOperationsRow[] = subjects.map((subject) => ({
      subject,
      ...(counters.get(subject.id) ?? { eventCount: 0, activeCount: 0, submittedCount: 0 }),
    }));
    const subjectNames = new Map(subjects.map((subject) => [subject.id, getLocalizedSubjectName(subject, locale)]));
    return { activeRooms, subjectNames, subjectRows, submissions };
  }, [exams, locale, subjects]);

  const retry = () => void queries.retry();
  return (
    <AdminShell activeNavigationKey="system" session={session} workspaceLabel={t.workspace}>
      <header className="routeHeader systemRouteHeader">
        <div><h1>{t.title}</h1><p>{t.description}</p></div>
        <Button disabled={queries.refreshing} onClick={retry} variant="secondary">{queries.refreshing ? t.refreshing : t.refresh}</Button>
      </header>

      {queries.failed ? <QueryErrorState description={t.errorDescription} onRetry={retry} retryLabel={t.retry} title={t.error} /> : queries.loading ? <PageSkeleton rows={9} /> : (
        <div className="systemPageFlow">
          <SystemMetricStrip ariaLabel={t.metrics} labels={t} metrics={{
            accounts: queries.accountTotal,
            subjects: subjects.length,
            activeRooms: overview.activeRooms,
            submissions: overview.submissions,
          }} />

          <section aria-labelledby="systemActionsTitle" className="systemActions">
            <header><h2 id="systemActionsTitle">{t.actions}</h2></header>
            <div>
              <Link className="systemActionRow" search={{}} to="/accounts"><strong>{t.accountAction}</strong><span>{t.accountDescription}</span><span aria-hidden="true">→</span></Link>
              <Link className="systemActionRow" to="/subjects"><strong>{t.subjectAction}</strong><span>{t.subjectDescription}</span><span aria-hidden="true">→</span></Link>
            </div>
          </section>

          <section aria-labelledby="systemSubjectsTitle" className="systemDataSection">
            <header><h2 id="systemSubjectsTitle">{t.subjectsTitle}</h2><span><Link className="tableTextLink" to="/subjects">{t.manageSubjects}</Link> · {subjects.length}</span></header>
            {overview.subjectRows.length > 0 ? <SubjectOperationsTable locale={locale} rows={overview.subjectRows} /> : <EmptyState description={t.emptySubjectsDescription} title={t.emptySubjects} />}
          </section>

          <section aria-labelledby="systemRecentTitle" className="systemDataSection">
            <header><h2 id="systemRecentTitle">{t.recentTitle}</h2><span>{Math.min(exams.length, 8)}</span></header>
            {exams.length > 0 ? <RecentSystemExams exams={exams.slice(0, 8)} locale={locale} subjectNames={overview.subjectNames} /> : <EmptyState description={t.emptyExamsDescription} title={t.emptyExams} />}
          </section>
        </div>
      )}
    </AdminShell>
  );
}
