import { useQuery } from "@tanstack/react-query";
import { createLazyRoute } from "@tanstack/react-router";

import { AdminShell } from "../../../app/layouts/AdminShell.tsx";
import { useAdminLocale } from "../../../shared/i18n/AdminLocaleProvider.tsx";
import { EmptyState, PageSkeleton, QueryErrorState } from "../../../shared/patterns/PageStates.tsx";
import { examEventQueryOptions } from "../../exams/api/examQueries.ts";
import { OperationsTable } from "../components/OperationsTable.tsx";
import { RecentExamTable } from "../components/RecentExamTable.tsx";

export const Route = createLazyRoute("/dashboard")({ component: DashboardPage });

const copy = {
  ja: {
    title: "教員ホーム",
    noSubject: "担当科目がありません",
    noSubjectDescription: "科目管理者に割り当てを依頼してください。",
    metrics: "本日の運用指標",
    active: "実施中",
    roster: "名簿人数",
    submitted: "提出済み",
    recent: "最近の試験",
    loading: "試験情報を読み込んでいます",
    error: "試験情報を取得できません",
    errorDescription: "ネットワークまたは権限状態を確認して、もう一度お試しください。",
    retry: "再読み込み",
    refreshing: "更新中",
  },
  zh: {
    title: "教师工作台",
    noSubject: "尚未分配科目",
    noSubjectDescription: "请联系科目管理员完成分配。",
    metrics: "当前运营指标",
    active: "进行中",
    roster: "名册人数",
    submitted: "已提交",
    recent: "最近考试",
    loading: "正在加载考试信息",
    error: "无法获取考试信息",
    errorDescription: "请检查网络或权限状态后重新尝试。",
    retry: "重新加载",
    refreshing: "更新中",
  },
  en: {
    title: "Teacher home", noSubject: "No subject assigned", noSubjectDescription: "Ask a subject administrator to assign one.",
    metrics: "Current operations", active: "Active", roster: "Students on roster", submitted: "Submitted", recent: "Recent exams",
    loading: "Loading exam information", error: "Exam information could not be loaded", errorDescription: "Check the connection or your permissions and try again.", retry: "Reload", refreshing: "Refreshing",
  },
} as const;

function DashboardPage() {
  const { locale } = useAdminLocale();
  const { session, subjectId } = Route.useLoaderData();
  const navigate = Route.useNavigate();
  const subject = session.workspaceSubjects.find((item) => item.id === subjectId) ?? null;
  const examsQuery = useQuery({
    ...examEventQueryOptions(subjectId ?? ""),
    enabled: Boolean(subjectId),
  });
  const exams = examsQuery.data ?? [];
  const t = copy[locale];

  const changeSubject = (nextSubjectId: string) => {
    void navigate({ search: { subjectId: nextSubjectId }, replace: true });
  };

  return (
    <AdminShell activeNavigationKey="dashboard" onSubjectChange={changeSubject} session={session} subject={subject}>
      <header className="dashboardHeader">
        <h1>{t.title}</h1>
        <p aria-live="polite" className="refreshStatus">
          {examsQuery.isFetching && !examsQuery.isLoading ? t.refreshing : ""}
        </p>
      </header>
      {!subject ? (
        <EmptyState description={t.noSubjectDescription} title={t.noSubject} />
      ) : (
        <div className="dashboardFlow">
          <section aria-label={t.metrics} className="metricBand">
            <div><span>{t.active}</span><strong>{exams.filter((exam) => exam.state === "active").length}</strong></div>
            <div><span>{t.roster}</span><strong>{exams.reduce((total, exam) => total + exam.rosterCount, 0)}</strong></div>
            <div><span>{t.submitted}</span><strong>{exams.reduce((total, exam) => total + exam.submittedCount, 0)}</strong></div>
          </section>

          <OperationsTable locale={locale} subject={subject} />

          <section aria-labelledby="recentExamsTitle" className="recentSection">
            <div className="sectionHeading">
              <h2 id="recentExamsTitle">{t.recent}</h2>
              <span>{locale === "ja" ? `${exams.length}件` : locale === "zh" ? `共 ${exams.length} 场` : `${exams.length} exams`}</span>
            </div>
            {examsQuery.isLoading ? <PageSkeleton rows={5} /> : null}
            {examsQuery.isError ? (
              <QueryErrorState
                description={t.errorDescription}
                onRetry={() => void examsQuery.refetch()}
                retryLabel={t.retry}
                title={t.error}
              />
            ) : null}
            {examsQuery.isSuccess ? <RecentExamTable exams={exams} locale={locale} /> : null}
          </section>
        </div>
      )}
    </AdminShell>
  );
}
