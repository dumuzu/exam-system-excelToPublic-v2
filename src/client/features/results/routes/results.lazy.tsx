import { useQuery } from "@tanstack/react-query";
import { createLazyRoute } from "@tanstack/react-router";
import { useCallback, useDeferredValue, useState } from "react";

import { AdminShell } from "../../../app/layouts/AdminShell.tsx";
import { examEventQueryOptions } from "../../exams/api/examQueries.ts";
import { useAdminLocale } from "../../../shared/i18n/AdminLocaleProvider.tsx";
import { EmptyState, PageSkeleton, QueryErrorState } from "../../../shared/patterns/PageStates.tsx";
import { PaginationBar } from "../../../shared/patterns/PaginationBar.tsx";
import { Button } from "../../../shared/ui/Button.tsx";
import { SelectField } from "../../../shared/ui/SelectField.tsx";
import { TextField } from "../../../shared/ui/TextField.tsx";
import { resultCsvUrl, warningCsvUrl } from "../api/resultApi.ts";
import { AuditLog } from "../components/AuditLog.tsx";
import { ResultOverview } from "../components/ResultOverview.tsx";
import { ResultReviewDialog } from "../components/ResultReviewDialog.tsx";
import { resultStatus } from "../components/ResultStatusBadge.tsx";
import { ResultTable } from "../components/ResultTable.tsx";
import { useResultSummaries } from "../hooks/useResultQueries.ts";
import type { ResultFilter, ResultSummary } from "../types.ts";
import "../styles/results.css";

export const Route = createLazyRoute("/results")({ component: ResultsPage });

const pageSize = 20;
const filters: readonly ResultFilter[] = ["all", "graded", "review_required", "pending", "failed"];

const labels = {
  ja: {
    title: "成績管理", count: (count: number) => `${count}名`, exam: "試験イベント", chooseExam: "試験を選択", search: "学生を検索", searchPlaceholder: "氏名または学籍番号",
    filters: { all: "すべて", graded: "採点済み", review_required: "確認待ち", pending: "未提出", failed: "採点失敗" }, refresh: "更新", refreshing: "更新中…",
    resultCsv: "成績 CSV", warningCsv: "監督ログ CSV", noSubject: "担当科目がありません", noSubjectDescription: "成績閲覧権限のある科目が割り当てられていません。",
    chooseTitle: "試験を選択してください", chooseDescription: "上の試験イベントを選択すると成績と監督ログを表示します。", noResults: "該当する学生がいません", noResultsDescription: "検索内容または採点状態を変更してください。",
    examLoadError: "試験一覧を読み込めません", resultsLoadError: "成績を読み込めません", retry: "再試行", previous: "前へ", next: "次へ", pagination: "学生別成績のページ", students: "学生別成績",
  },
  zh: {
    title: "成绩管理", count: (count: number) => `共 ${count} 人`, exam: "考试事件", chooseExam: "请选择考试", search: "搜索学生", searchPlaceholder: "姓名或学号",
    filters: { all: "全部", graded: "已评分", review_required: "待校对", pending: "未提交", failed: "评分失败" }, refresh: "刷新", refreshing: "刷新中…",
    resultCsv: "成绩 CSV", warningCsv: "监考日志 CSV", noSubject: "尚未分配科目", noSubjectDescription: "当前账户没有可查看成绩的科目。",
    chooseTitle: "请选择考试", chooseDescription: "选择上方考试事件后查看成绩与监考日志。", noResults: "没有符合条件的学生", noResultsDescription: "请调整搜索内容或评分状态。",
    examLoadError: "无法加载考试列表", resultsLoadError: "无法加载成绩", retry: "重试", previous: "上一页", next: "下一页", pagination: "学生成绩分页", students: "学生成绩",
  },
  en: {
    title: "Results", count: (count: number) => `${count} students`, exam: "Exam event", chooseExam: "Choose an exam", search: "Search students", searchPlaceholder: "Name or student number",
    filters: { all: "All", graded: "Graded", review_required: "Review required", pending: "Not submitted", failed: "Grading failed" }, refresh: "Refresh", refreshing: "Refreshing…",
    resultCsv: "Results CSV", warningCsv: "Proctoring log CSV", noSubject: "No subject assigned", noSubjectDescription: "This account has no subject with permission to view results.",
    chooseTitle: "Choose an exam", chooseDescription: "Choose an exam event above to view results and the proctoring log.", noResults: "No students match", noResultsDescription: "Change the search or grading status.",
    examLoadError: "Exam list could not be loaded", resultsLoadError: "Results could not be loaded", retry: "Try again", previous: "Previous", next: "Next", pagination: "Student result pages", students: "Student results",
  },
} as const;

function matchesFilter(result: ResultSummary, filter: ResultFilter): boolean {
  return filter === "all" || resultStatus(result) === filter;
}

function ResultsPage() {
  const { locale } = useAdminLocale();
  const { session, subjectId } = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const subject = session.workspaceSubjects.find((item) => item.id === subjectId) ?? null;
  const examsQuery = useQuery({ ...examEventQueryOptions(subject?.id ?? "missing"), enabled: Boolean(subject) });
  const selectedExam = examsQuery.data?.find((exam) => exam.code === search.examId) ?? null;
  const resultsQuery = useResultSummaries(subject?.id ?? "missing", selectedExam?.code ?? "missing", Boolean(subject && selectedExam));
  const deferredQuery = useDeferredValue(search.query ?? "");
  const [reviewStudentNumber, setReviewStudentNumber] = useState<string | null>(null);
  const t = labels[locale];
  const filter = search.status ?? "all";
  const normalizedQuery = deferredQuery.normalize("NFKC").toLocaleLowerCase();
  const filteredResults = (resultsQuery.data ?? []).filter((result) => matchesFilter(result, filter)).filter((result) => (
    !normalizedQuery || `${result.studentNumber} ${result.name}`.normalize("NFKC").toLocaleLowerCase().includes(normalizedQuery)
  ));
  const totalPages = Math.max(1, Math.ceil(filteredResults.length / pageSize));
  const currentPage = Math.min(search.page ?? 1, totalPages);
  const visibleResults = filteredResults.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const handleReview = useCallback((result: ResultSummary) => {
    setReviewStudentNumber(result.studentNumber);
  }, []);

  const changeSubject = (nextSubjectId: string) => {
    setReviewStudentNumber(null);
    void navigate({ search: { subjectId: nextSubjectId }, replace: true });
  };

  const changeExam = (examId: string) => {
    if (!subject) return;
    setReviewStudentNumber(null);
    void navigate({ search: examId ? { subjectId: subject.id, examId } : { subjectId: subject.id }, replace: true });
  };

  const changeFilter = (status: ResultFilter) => {
    void navigate({ search: (current) => {
      const next = { ...current };
      delete next.page;
      if (status === "all") delete next.status;
      else next.status = status;
      return next;
    }, replace: true });
  };

  const refresh = () => {
    void Promise.all([examsQuery.refetch(), ...(selectedExam ? [resultsQuery.refetch()] : [])]);
  };

  return (
    <AdminShell activeNavigationKey="results" onSubjectChange={changeSubject} session={session} subject={subject}>
      <header className="routeHeader">
        <div><h1>{t.title}</h1><span>{t.count(filteredResults.length)}</span></div>
        <div className="routeHeaderActions">
          {selectedExam && subject?.permissions.includes("export_results") ? <><a className="uiButton uiButtonSecondary exportLink" href={resultCsvUrl(selectedExam.code)}>{t.resultCsv}</a><a className="uiButton uiButtonSecondary exportLink" href={warningCsvUrl(selectedExam.code)}>{t.warningCsv}</a></> : null}
          <Button disabled={examsQuery.isFetching || resultsQuery.isFetching} onClick={refresh} variant="secondary">{examsQuery.isFetching || resultsQuery.isFetching ? t.refreshing : t.refresh}</Button>
        </div>
      </header>

      {!subject ? <EmptyState description={t.noSubjectDescription} title={t.noSubject} /> : (
        <div className="resultPageFlow">
          <section aria-label={locale === "ja" ? "成績フィルター" : locale === "zh" ? "成绩筛选" : "Result filters"} className="resultControlBar">
            <SelectField id="resultExam" label={t.exam} onChange={(event) => changeExam(event.currentTarget.value)} options={[{ label: t.chooseExam, value: "" }, ...(examsQuery.data ?? []).map((exam) => ({ label: `${exam.titleJa} · ${exam.code}`, value: exam.code }))]} value={selectedExam?.code ?? ""} />
            <TextField id="resultSearch" label={t.search} onChange={(event) => {
              const query = event.currentTarget.value;
              void navigate({ search: (current) => {
                const next = { ...current };
                delete next.page;
                if (query) next.query = query;
                else delete next.query;
                return next;
              }, replace: true });
            }} placeholder={t.searchPlaceholder} type="search" value={search.query ?? ""} />
            <div aria-label={locale === "ja" ? "採点状態" : locale === "zh" ? "评分状态" : "Grading status"} className="filterTabs" role="group">
              {filters.map((item) => <Button aria-pressed={filter === item} key={item} onClick={() => changeFilter(item)} variant="quiet">{t.filters[item]}</Button>)}
            </div>
          </section>

          {examsQuery.isLoading ? <PageSkeleton rows={5} /> : null}
          {examsQuery.isError ? <QueryErrorState description={t.examLoadError} onRetry={() => void examsQuery.refetch()} retryLabel={t.retry} title={t.examLoadError} /> : null}
          {!examsQuery.isLoading && !examsQuery.isError && !selectedExam ? <EmptyState description={t.chooseDescription} title={t.chooseTitle} /> : null}
          {selectedExam && resultsQuery.isLoading ? <PageSkeleton rows={8} /> : null}
          {selectedExam && resultsQuery.isError ? <QueryErrorState description={t.resultsLoadError} onRetry={() => void resultsQuery.refetch()} retryLabel={t.retry} title={t.resultsLoadError} /> : null}
          {selectedExam && resultsQuery.data ? (
            <>
              <ResultOverview locale={locale} results={resultsQuery.data} />
              <section className="resultTablePanel"><header><h2>{t.students}</h2><span>{t.count(filteredResults.length)}</span></header>
                {visibleResults.length > 0 ? <ResultTable locale={locale} onReview={handleReview} results={visibleResults} /> : <EmptyState description={t.noResultsDescription} title={t.noResults} />}
                <PaginationBar currentPage={currentPage} label={t.pagination} nextLabel={t.next} onPageChange={(page) => void navigate({ search: (current) => ({ ...current, page }), replace: true })} previousLabel={t.previous} totalPages={totalPages} />
              </section>
              <AuditLog locale={locale} results={resultsQuery.data} />
              <ResultReviewDialog canAdjust={subject.permissions.includes("adjust_grades")} csrfToken={session.csrfToken} examCode={selectedExam.code} locale={locale} onClose={() => setReviewStudentNumber(null)} studentNumber={reviewStudentNumber} subjectId={subject.id} />
            </>
          ) : null}
        </div>
      )}
    </AdminShell>
  );
}
