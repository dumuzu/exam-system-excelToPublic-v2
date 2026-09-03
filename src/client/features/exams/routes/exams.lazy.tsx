import { useQuery } from "@tanstack/react-query";
import { createLazyRoute } from "@tanstack/react-router";
import { useCallback, useDeferredValue, useState } from "react";
import { toast } from "sonner";

import { AdminShell } from "../../../app/layouts/AdminShell.tsx";
import { ApiRequestError } from "../../../shared/api/httpClient.ts";
import { useAdminLocale } from "../../../shared/i18n/AdminLocaleProvider.tsx";
import { DestructiveConfirmDialog } from "../../../shared/patterns/DestructiveConfirmDialog.tsx";
import { EmptyState, InlineFeedback, PageSkeleton, QueryErrorState } from "../../../shared/patterns/PageStates.tsx";
import { PaginationBar } from "../../../shared/patterns/PaginationBar.tsx";
import { Button } from "../../../shared/ui/Button.tsx";
import { TextField } from "../../../shared/ui/TextField.tsx";
import { examEventQueryOptions } from "../api/examQueries.ts";
import { ExamEventTable } from "../components/ExamEventTable.tsx";
import { useDeleteExamMutation, useTerminateExamMutation } from "../hooks/useExamLifecycleMutations.ts";
import type { ExamEvent, ExamEventFilter, TerminationProgress } from "../types.ts";

export const Route = createLazyRoute("/exams")({ component: ExamEventsPage });

const pageSize = 20;
const filters: readonly ExamEventFilter[] = ["all", "active", "preparing", "closed"];

const copy = {
  ja: {
    title: "考場管理", search: "試験を検索", searchPlaceholder: "試験名またはコード", refresh: "更新", refreshing: "更新中…",
    filters: { all: "すべて", active: "実施中", preparing: "準備中", closed: "終了" },
    empty: "該当する試験はありません", emptyDescription: "検索条件または状態フィルターを変更してください。",
    noSubject: "担当科目がありません", noSubjectDescription: "科目管理者に割り当てを依頼してください。",
    loadError: "試験一覧を読み込めません", retry: "再試行", resultCount: (count: number) => `${count}件`,
    previous: "前へ", next: "次へ", pagination: "試験一覧のページ",
    cancel: "キャンセル", terminateTitle: "試験イベントを中止", terminateConfirm: "試験を中止", terminatePending: "答案を回収中…",
    terminateDescription: "新しい入室と回答を停止し、オンライン端の最終同期後に保存済み答案を一括提出します。この操作は元に戻せません。",
    assignmentTerminateDescription: "新しい入室を停止します。すでに開いている課題画面は提出完了まで保護されます。",
    deleteTitle: "試験イベントを削除", deleteConfirm: "完全に削除", deletePending: "削除中…",
    deleteDescription: "名簿、答案、成績を含む関連データを完全に削除します。この操作は元に戻せません。",
    collecting: (seconds: number) => `オンライン答案の最終同期を待っています（残り ${seconds} 秒）`,
    processing: (count: number) => `保存済み答案を回収しています（残り ${count} 件）`,
    terminateDone: "試験を中止し、受験中の答案を処理しました。", assignmentTerminateDone: "課題への新しい入室を停止しました。",
    deleteDone: "試験イベントを削除しました。", actionError: "操作を完了できませんでした。",
    deleteBlocked: "未提出の答案が残っているため削除できません。", deleteNeedsTermination: "実施中の試験は先に中止してください。",
  },
  zh: {
    title: "考场管理", search: "搜索考试", searchPlaceholder: "考试名称或代码", refresh: "刷新", refreshing: "刷新中…",
    filters: { all: "全部", active: "进行中", preparing: "准备中", closed: "已结束" },
    empty: "没有符合条件的考试", emptyDescription: "请调整搜索内容或状态筛选。",
    noSubject: "尚未分配科目", noSubjectDescription: "请联系科目管理员完成分配。",
    loadError: "无法加载考试列表", retry: "重试", resultCount: (count: number) => `共 ${count} 场`,
    previous: "上一页", next: "下一页", pagination: "考试列表分页",
    cancel: "取消", terminateTitle: "中止考试事件", terminateConfirm: "中止考试", terminatePending: "正在收卷…",
    terminateDescription: "系统将停止新的入场与答题，在在线端完成最后同步后批量提交已保存答案。此操作无法撤销。",
    assignmentTerminateDescription: "系统将停止新的学生进入，已经打开的课堂课题会保护到提交完成。",
    deleteTitle: "删除考试事件", deleteConfirm: "永久删除", deletePending: "删除中…",
    deleteDescription: "相关名册、答卷和成绩将被永久删除，并且无法恢复。",
    collecting: (seconds: number) => `正在等待在线答卷完成最后同步（剩余 ${seconds} 秒）`,
    processing: (count: number) => `正在回收服务器保存的答卷（剩余 ${count} 份）`,
    terminateDone: "考试已中止，正在作答的试卷已经处理。", assignmentTerminateDone: "已停止新的学生进入课堂课题。",
    deleteDone: "考试事件已删除。", actionError: "操作未能完成。",
    deleteBlocked: "仍有学生答案尚未提交，暂时不能删除。", deleteNeedsTermination: "进行中的考试需要先中止。",
  },
  en: {
    title: "Exam rooms", search: "Search exams", searchPlaceholder: "Exam name or code", refresh: "Refresh", refreshing: "Refreshing…",
    filters: { all: "All", active: "Active", preparing: "Preparing", closed: "Closed" }, empty: "No exams match", emptyDescription: "Change the search or status filter.",
    noSubject: "No subject assigned", noSubjectDescription: "Ask a subject administrator to assign one.", loadError: "Exam list could not be loaded", retry: "Try again", resultCount: (count: number) => `${count} exams`,
    previous: "Previous", next: "Next", pagination: "Exam list pages", cancel: "Cancel", terminateTitle: "Terminate exam event", terminateConfirm: "Terminate exam", terminatePending: "Collecting papers…",
    terminateDescription: "Stop new entry and answers, wait for a final online sync, then submit the latest saved papers in one operation. This cannot be undone.", assignmentTerminateDescription: "Stop new students from entering. Assignment pages that are already open remain protected until submission.",
    deleteTitle: "Delete exam event", deleteConfirm: "Delete permanently", deletePending: "Deleting…", deleteDescription: "Permanently delete the roster, papers, results, and related data. This cannot be undone.",
    collecting: (seconds: number) => `Waiting for the final online sync (${seconds} seconds remaining)`, processing: (count: number) => `Collecting saved papers (${count} remaining)`, terminateDone: "The exam was terminated and active papers were processed.", assignmentTerminateDone: "New entry to the assignment has been stopped.",
    deleteDone: "Exam event deleted.", actionError: "The operation could not be completed.", deleteBlocked: "The exam still has unsubmitted papers and cannot be deleted.", deleteNeedsTermination: "Terminate the active exam before deleting it.",
  },
} as const;

type LifecycleTarget = { action: "delete" | "terminate"; exam: ExamEvent };
type Feedback = { message: string };

function matchesFilter(exam: ExamEvent, filter: ExamEventFilter): boolean {
  if (filter === "active") return exam.state === "active" && !exam.terminated;
  if (filter === "preparing") return exam.preparationStatus !== "ready" && exam.state !== "closed" && exam.state !== "archived";
  if (filter === "closed") return exam.state === "closed" || exam.state === "archived" || exam.terminated;
  return true;
}

function ExamEventsPage() {
  const { locale } = useAdminLocale();
  const { session, subjectId } = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const subject = session.workspaceSubjects.find((item) => item.id === subjectId) ?? null;
  const examsQuery = useQuery({ ...examEventQueryOptions(subject?.id ?? "missing"), enabled: Boolean(subject) });
  const terminateMutation = useTerminateExamMutation(subject?.id ?? "missing");
  const deleteMutation = useDeleteExamMutation(subject?.id ?? "missing");
  const deferredQuery = useDeferredValue(search.query ?? "");
  const [lifecycleTarget, setLifecycleTarget] = useState<LifecycleTarget | null>(null);
  const [progress, setProgress] = useState<TerminationProgress | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const t = copy[locale];
  const filter = search.status ?? "all";
  const normalizedQuery = deferredQuery.normalize("NFKC").toLocaleLowerCase();
  const filteredExams = (examsQuery.data ?? []).filter((exam) => matchesFilter(exam, filter)).filter((exam) => (
    !normalizedQuery || `${exam.code} ${exam.titleJa}`.normalize("NFKC").toLocaleLowerCase().includes(normalizedQuery)
  ));
  const totalPages = Math.max(1, Math.ceil(filteredExams.length / pageSize));
  const currentPage = Math.min(search.page ?? 1, totalPages);
  const visibleExams = filteredExams.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const pending = terminateMutation.isPending || deleteMutation.isPending;
  const handleDelete = useCallback((exam: ExamEvent) => {
    setLifecycleTarget({ action: "delete", exam });
  }, []);
  const handleTerminate = useCallback((exam: ExamEvent) => {
    setLifecycleTarget({ action: "terminate", exam });
  }, []);

  const changeSubject = (nextSubjectId: string) => {
    void navigate({ search: (current) => {
      const next = { ...current, subjectId: nextSubjectId };
      delete next.page;
      return next;
    }, replace: true });
  };

  const changeFilter = (status: ExamEventFilter) => {
    void navigate({ search: (current) => {
      const next = { ...current };
      delete next.page;
      if (status === "all") delete next.status;
      else next.status = status;
      return next;
    }, replace: true });
  };

  const closeDialog = () => {
    if (pending) return;
    setLifecycleTarget(null);
    setProgress(null);
  };

  const mutationError = (error: unknown): string => {
    if (error instanceof ApiRequestError && error.code === "EXAM_HAS_IN_PROGRESS_ATTEMPTS") return t.deleteBlocked;
    if (error instanceof ApiRequestError && error.code === "EXAM_MUST_BE_TERMINATED") return t.deleteNeedsTermination;
    return t.actionError;
  };

  const confirmLifecycle = () => {
    if (!lifecycleTarget || !subject) return;
    setFeedback(null);
    if (lifecycleTarget.action === "terminate") {
      const target = lifecycleTarget.exam;
      terminateMutation.mutate({ csrfToken: session.csrfToken, exam: target, onProgress: setProgress, subjectId: subject.id }, {
        onSuccess: () => {
          toast.success(target.mode === "assignment" ? t.assignmentTerminateDone : t.terminateDone);
          setLifecycleTarget(null);
        },
        onError: (error) => {
          setFeedback({ message: mutationError(error) });
          setLifecycleTarget(null);
        },
        onSettled: () => setProgress(null),
      });
      return;
    }
    deleteMutation.mutate({ csrfToken: session.csrfToken, exam: lifecycleTarget.exam, subjectId: subject.id }, {
      onSuccess: () => {
        toast.success(t.deleteDone);
        setLifecycleTarget(null);
      },
      onError: (error) => {
        setFeedback({ message: mutationError(error) });
        setLifecycleTarget(null);
      },
    });
  };

  const progressLabel = progress?.phase === "collecting"
    ? t.collecting(progress.remainingSeconds ?? 0)
    : progress?.phase === "processing"
      ? t.processing(progress.pendingSubmissionCount ?? 0)
      : undefined;
  const targetExam = lifecycleTarget?.exam ?? null;
  const terminating = lifecycleTarget?.action === "terminate";

  return (
    <AdminShell activeNavigationKey="rooms" onSubjectChange={changeSubject} session={session} subject={subject}>
      <header className="routeHeader">
        <div><h1>{t.title}</h1><span>{t.resultCount(filteredExams.length)}</span></div>
        <Button disabled={examsQuery.isFetching} onClick={() => void examsQuery.refetch()} variant="secondary">
          {examsQuery.isFetching ? t.refreshing : t.refresh}
        </Button>
      </header>

      {!subject ? <EmptyState description={t.noSubjectDescription} title={t.noSubject} /> : (
        <div className="examListFlow">
          <section aria-label={locale === "ja" ? "試験一覧フィルター" : locale === "zh" ? "考试列表筛选" : "Exam list filters"} className="filterBar">
            <TextField
              id="examSearch"
              label={t.search}
              onChange={(event) => {
                const value = event.currentTarget.value;
                void navigate({ search: (current) => {
                  const next = { ...current };
                  delete next.page;
                  if (value) next.query = value;
                  else delete next.query;
                  return next;
                }, replace: true });
              }}
              placeholder={t.searchPlaceholder}
              type="search"
              value={search.query ?? ""}
            />
            <div aria-label={locale === "ja" ? "状態" : locale === "zh" ? "状态" : "Status"} className="filterTabs" role="group">
              {filters.map((item) => (
                <Button aria-pressed={filter === item} key={item} onClick={() => changeFilter(item)} variant="quiet">{t.filters[item]}</Button>
              ))}
            </div>
          </section>

          {feedback ? <InlineFeedback tone="error">{feedback.message}</InlineFeedback> : null}
          {examsQuery.isLoading ? <PageSkeleton rows={8} /> : null}
          {examsQuery.isError ? <QueryErrorState description={t.actionError} onRetry={() => void examsQuery.refetch()} retryLabel={t.retry} title={t.loadError} /> : null}
          {!examsQuery.isLoading && !examsQuery.isError && visibleExams.length === 0 ? <EmptyState description={t.emptyDescription} title={t.empty} /> : null}
          {visibleExams.length > 0 ? (
            <ExamEventTable
              canDelete={subject.permissions.includes("delete_exam")}
              canTerminate={subject.permissions.includes("terminate_exam")}
              exams={visibleExams}
              locale={locale}
              onDelete={handleDelete}
              onTerminate={handleTerminate}
            />
          ) : null}
          <PaginationBar currentPage={currentPage} label={t.pagination} nextLabel={t.next} onPageChange={(page) => void navigate({ search: (current) => ({ ...current, page }), replace: true })} previousLabel={t.previous} totalPages={totalPages} />
        </div>
      )}

      <DestructiveConfirmDialog
        cancelLabel={t.cancel}
        confirmLabel={terminating ? t.terminateConfirm : t.deleteConfirm}
        description={terminating ? (targetExam?.mode === "assignment" ? t.assignmentTerminateDescription : t.terminateDescription) : t.deleteDescription}
        objectLabel={targetExam?.code ?? ""}
        onCancel={closeDialog}
        onConfirm={confirmLifecycle}
        open={Boolean(lifecycleTarget)}
        pending={pending}
        pendingLabel={terminating ? t.terminatePending : t.deletePending}
        {...(progressLabel ? { progress: progressLabel } : {})}
        title={terminating ? t.terminateTitle : t.deleteTitle}
      />
    </AdminShell>
  );
}
