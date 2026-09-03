import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createLazyRoute } from "@tanstack/react-router";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import type { RoomTerminationFailure } from "../../../../types/contracts/exam-room.ts";
import { AdminShell } from "../../../app/layouts/AdminShell.tsx";
import { adminSessionQueryKey } from "../../auth/api/authQueries.ts";
import { ApiRequestError } from "../../../shared/api/httpClient.ts";
import { adminExamQueryKeys } from "../../../shared/api/queryKeys.ts";
import { useAdminLocale } from "../../../shared/i18n/AdminLocaleProvider.tsx";
import { getLocalizedSubjectName } from "../../../shared/i18n/subjectNames.ts";
import { DestructiveConfirmDialog } from "../../../shared/patterns/DestructiveConfirmDialog.tsx";
import { InlineFeedback, PageSkeleton, QueryErrorState } from "../../../shared/patterns/PageStates.tsx";
import { Button } from "../../../shared/ui/Button.tsx";
import { examRoomQueryOptions, roomTerminationFailureQueryOptions } from "../api/examRoomQueries.ts";
import { AttendanceTable } from "../components/AttendanceTable.tsx";
import { RoomActionDialog } from "../components/RoomActionDialog.tsx";
import { RoomFailureRetryDialog } from "../components/RoomFailureRetryDialog.tsx";
import { RoomFilterBar } from "../components/RoomFilterBar.tsx";
import { RoomSummary } from "../components/RoomSummary.tsx";
import { TerminationFailuresPanel } from "../components/TerminationFailuresPanel.tsx";
import { examRoomCopy } from "../copy.ts";
import {
  useAdmitRoomStudentMutation,
  useAdmitSelectedRoomStudentsMutation,
  useAuthorizeRoomResumeMutation,
  useAuthorizeRoomRetakeMutation,
  useRetryRoomTerminationFailureMutation,
  useTerminateRoomMutation,
} from "../hooks/useExamRoomMutations.ts";
import {
  filterRoomStudents,
  reconcileWaitingSelection,
  roomSummaryMetrics,
  selectableWaitingStudentNumbers,
} from "../model/roomView.ts";
import type { RoomStatusFilter, RoomStudentActionTarget, RoomTerminationProgress } from "../types.ts";
import "../styles/examRoom.css";

export const Route = createLazyRoute("/exams/$examCode/room")({ component: ExamRoomPage });

const emptyStudents = [] as const;
const roomAccessFailureStatuses = new Set([401, 403, 404]);
const roomUpdatedAtFormatters: Record<"ja" | "zh" | "en", Intl.DateTimeFormat> = {
  ja: new Intl.DateTimeFormat("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
  zh: new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
  en: new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
};

function isRoomAccessFailure(error: unknown): error is ApiRequestError {
  return error instanceof ApiRequestError && roomAccessFailureStatuses.has(error.status);
}

interface RoomAccessFailureState {
  examCode: string;
  error: ApiRequestError;
}

function ExamRoomPage() {
  const queryClient = useQueryClient();
  const { locale } = useAdminLocale();
  const { examCode, session } = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const [selectedStudentNumbers, setSelectedStudentNumbers] = useState<ReadonlySet<string>>(() => new Set());
  const [studentActionTarget, setStudentActionTarget] = useState<RoomStudentActionTarget | null>(null);
  const [retryFailureTarget, setRetryFailureTarget] = useState<RoomTerminationFailure | null>(null);
  const [terminationOpen, setTerminationOpen] = useState(false);
  const [terminationActive, setTerminationActive] = useState(false);
  const [terminationProgress, setTerminationProgress] = useState<RoomTerminationProgress | null>(null);
  const [manualRefreshPending, setManualRefreshPending] = useState(false);
  const [accessFailureState, setAccessFailureState] = useState<RoomAccessFailureState | null>(null);
  const admissionLockRef = useRef(false);
  const deferredQuery = useDeferredValue(search.query ?? "");
  const t = examRoomCopy[locale];

  const handleRoomAccessFailure = useCallback((error: unknown): boolean => {
    if (!isRoomAccessFailure(error)) return false;
    setAccessFailureState({ examCode, error });
    setSelectedStudentNumbers(new Set());
    setStudentActionTarget(null);
    setRetryFailureTarget(null);
    setTerminationOpen(false);
    setTerminationActive(false);
    setTerminationProgress(null);

    // 查询与操作共用同一失效路径，权限撤销后立即清除房间中的学生信息。
    void Promise.all([
      queryClient.cancelQueries({ queryKey: adminExamQueryKeys.room(examCode), exact: true }),
      queryClient.cancelQueries({ queryKey: adminExamQueryKeys.roomFailures(examCode), exact: true }),
    ]).then(() => {
      queryClient.removeQueries({ queryKey: adminExamQueryKeys.room(examCode), exact: true });
      queryClient.removeQueries({ queryKey: adminExamQueryKeys.roomFailures(examCode), exact: true });
      if (error.status === 401) {
        queryClient.removeQueries({ queryKey: adminSessionQueryKey, exact: true });
        globalThis.location.replace("/admin/login/");
      }
    });
    return true;
  }, [examCode, queryClient]);

  const storedAccessFailure = accessFailureState?.examCode === examCode ? accessFailureState.error : null;
  const roomQuery = useQuery({
    ...examRoomQueryOptions(examCode, !terminationActive),
    enabled: storedAccessFailure === null,
  });
  const roomQueryAccessFailure = isRoomAccessFailure(roomQuery.error) ? roomQuery.error : null;
  const initialFormalRoom = roomQuery.data?.room.mode === "exam";
  const failuresQuery = useQuery({
    ...roomTerminationFailureQueryOptions(examCode, !terminationActive),
    enabled: initialFormalRoom && storedAccessFailure === null && roomQueryAccessFailure === null,
  });
  const failuresQueryAccessFailure = isRoomAccessFailure(failuresQuery.error) ? failuresQuery.error : null;
  const currentAccessFailure = storedAccessFailure ?? roomQueryAccessFailure ?? failuresQueryAccessFailure;
  const snapshot = currentAccessFailure ? undefined : roomQuery.data;
  const mutationScope = useMemo(() => ({
    examCode,
    subjectId: snapshot?.room.subjectId ?? "pending",
  }), [examCode, snapshot?.room.subjectId]);
  const admitMutation = useAdmitRoomStudentMutation(mutationScope);
  const admitSelectedMutation = useAdmitSelectedRoomStudentsMutation(mutationScope);
  const resumeMutation = useAuthorizeRoomResumeMutation(mutationScope);
  const retakeMutation = useAuthorizeRoomRetakeMutation(mutationScope);
  const retryFailureMutation = useRetryRoomTerminationFailureMutation(mutationScope);
  const terminateMutation = useTerminateRoomMutation(mutationScope);
  const admitStudent = admitMutation.mutate;
  const admitSelectedStudents = admitSelectedMutation.mutate;
  const authorizeResume = resumeMutation.mutate;
  const authorizeRetake = retakeMutation.mutate;
  const retryFailure = retryFailureMutation.mutate;
  const terminateRoom = terminateMutation.mutate;
  const roomTerminating = terminateMutation.isPending;
  const room = snapshot?.room;
  const students = snapshot?.students ?? emptyStudents;
  const formalRoom = room?.mode === "exam";
  const subject = room
    ? session.workspaceSubjects.find((item) => item.id === room.subjectId) ?? null
    : null;
  const permissions = snapshot?.permissions ?? [];
  const canManageAdmission = permissions.includes("manage_admission");
  const canAuthorizeResume = permissions.includes("authorize_resume");
  const canAuthorizeRetake = permissions.includes("authorize_retake");
  const canTerminate = permissions.includes("terminate_exam");
  const visibleStudents = useMemo(() => room
    ? filterRoomStudents(students, room.mode, deferredQuery, search.status)
    : [], [deferredQuery, room, search.status, students]);
  const summaryMetrics = useMemo(() => room ? roomSummaryMetrics(room, students) : [], [room, students]);
  const activeStatus: RoomStatusFilter = search.status;

  useEffect(() => {
    const error = roomQueryAccessFailure ?? failuresQueryAccessFailure;
    if (!error) return;
    handleRoomAccessFailure(error);
  }, [failuresQueryAccessFailure, handleRoomAccessFailure, roomQueryAccessFailure]);

  useEffect(() => {
    setAccessFailureState((current) => current?.examCode === examCode ? current : null);
    admissionLockRef.current = false;
  }, [examCode]);

  useEffect(() => {
    setSelectedStudentNumbers((current) => reconcileWaitingSelection(current, visibleStudents));
  }, [visibleStudents]);

  const handleSelect = useCallback((studentNumber: string, selected: boolean) => {
    setSelectedStudentNumbers((current) => {
      const next = new Set(current);
      if (selected) next.add(studentNumber);
      else next.delete(studentNumber);
      return next;
    });
  }, []);

  const handleQueryChange = useCallback((query: string) => {
    void navigate({
      replace: true,
      search: (current) => {
        const next = { ...current };
        if (query) next.query = query;
        else delete next.query;
        return next;
      },
    });
  }, [navigate]);

  const handleStatusChange = useCallback((status: RoomStatusFilter) => {
    void navigate({
      replace: true,
      search: (current) => {
        const next = { ...current };
        if (status) next.status = status;
        else delete next.status;
        return next;
      },
    });
  }, [navigate]);

  const handleClearFilters = useCallback(() => {
    setSelectedStudentNumbers(new Set());
    void navigate({ replace: true, search: {} });
  }, [navigate]);

  const handleAdmit = useCallback((studentNumber: string) => {
    if (admissionLockRef.current) return;
    admissionLockRef.current = true;
    admitStudent({ csrfToken: session.csrfToken, studentNumber }, {
      onSuccess: () => toast.success(locale === "ja" ? "学生を許可しました。" : locale === "zh" ? "已放行该学生。" : "Student admitted."),
      onError: (error) => {
        if (!handleRoomAccessFailure(error)) toast.error(t.actionError);
      },
      onSettled: () => {
        admissionLockRef.current = false;
      },
    });
  }, [admitStudent, handleRoomAccessFailure, locale, session.csrfToken, t.actionError]);

  const handleAdmitSelected = useCallback(() => {
    if (admissionLockRef.current) return;
    const visibleWaiting = new Set(selectableWaitingStudentNumbers(visibleStudents));
    const studentNumbers = [...selectedStudentNumbers].filter((studentNumber) => visibleWaiting.has(studentNumber));
    if (studentNumbers.length === 0) return;
    admissionLockRef.current = true;
    admitSelectedStudents({ csrfToken: session.csrfToken, studentNumbers }, {
      onSuccess: (result) => {
        setSelectedStudentNumbers(new Set());
        toast.success(locale === "ja" ? `${result.admittedCount}名を許可しました。` : locale === "zh" ? `已放行 ${result.admittedCount} 名学生。` : `${result.admittedCount} students admitted.`);
      },
      onError: (error) => {
        if (!handleRoomAccessFailure(error)) toast.error(t.actionError);
      },
      onSettled: () => {
        admissionLockRef.current = false;
      },
    });
  }, [admitSelectedStudents, handleRoomAccessFailure, locale, selectedStudentNumbers, session.csrfToken, t.actionError, visibleStudents]);

  const handleStudentActionConfirm = useCallback((target: RoomStudentActionTarget) => {
    const mutation = target.action === "resume" ? authorizeResume : authorizeRetake;
    mutation({ csrfToken: session.csrfToken, studentNumber: target.student.studentNumber }, {
      onSuccess: () => {
        setStudentActionTarget(null);
        toast.success(target.action === "resume" ? t.resumeDone : t.retakeDone);
      },
      onError: (error) => {
        setStudentActionTarget(null);
        if (!handleRoomAccessFailure(error)) toast.error(t.actionError);
      },
    });
  }, [authorizeResume, authorizeRetake, handleRoomAccessFailure, session.csrfToken, t]);

  const handleRetryFailure = useCallback((failure: RoomTerminationFailure) => {
    retryFailure({ attemptId: failure.attemptId, csrfToken: session.csrfToken }, {
      onSuccess: () => {
        setRetryFailureTarget(null);
        toast.success(t.retryFailureDone);
      },
      onError: (error) => {
        setRetryFailureTarget(null);
        if (!handleRoomAccessFailure(error)) toast.error(t.actionError);
      },
    });
  }, [handleRoomAccessFailure, retryFailure, session.csrfToken, t.actionError, t.retryFailureDone]);

  const handleTerminate = useCallback(() => {
    if (!room) return;
    // 收卷期间暂停轮询；结束后 Mutation invalidation 会同步服务端最终状态。
    setTerminationActive(true);
    terminateRoom({ csrfToken: session.csrfToken, mode: room.mode, onProgress: setTerminationProgress }, {
      onSuccess: (result) => {
        setTerminationOpen(false);
        toast.success(t.terminateDone(result.teacherSubmittedCount));
      },
      onError: (error) => {
        setTerminationOpen(false);
        if (!handleRoomAccessFailure(error)) toast.error(t.actionError);
      },
      onSettled: () => {
        setTerminationActive(false);
        setTerminationProgress(null);
      },
    });
  }, [handleRoomAccessFailure, room, session.csrfToken, t, terminateRoom]);

  const refresh = async () => {
    if (manualRefreshPending || currentAccessFailure) return;
    setManualRefreshPending(true);
    try {
      await Promise.all([
        roomQuery.refetch(),
        ...(formalRoom ? [failuresQuery.refetch()] : []),
      ]);
    } finally {
      setManualRefreshPending(false);
    }
  };
  const pendingAction = admitMutation.isPending && admitMutation.variables
    ? { action: "admit" as const, studentNumber: admitMutation.variables.studentNumber }
    : resumeMutation.isPending && resumeMutation.variables
      ? { action: "resume" as const, studentNumber: resumeMutation.variables.studentNumber }
      : retakeMutation.isPending && retakeMutation.variables
        ? { action: "retake" as const, studentNumber: retakeMutation.variables.studentNumber }
        : null;
  const actionDialogPending = resumeMutation.isPending || retakeMutation.isPending;
  const admissionPending = admitMutation.isPending || admitSelectedMutation.isPending;
  const selectedVisibleCount = useMemo(() => {
    const visibleWaiting = new Set(selectableWaitingStudentNumbers(visibleStudents));
    return [...selectedStudentNumbers].filter((studentNumber) => visibleWaiting.has(studentNumber)).length;
  }, [selectedStudentNumbers, visibleStudents]);
  const progressLabel = terminationProgress?.phase === "collecting"
    ? t.terminateCollecting(terminationProgress.remainingSeconds ?? 0)
    : terminationProgress?.phase === "processing"
      ? t.terminateProcessing(terminationProgress.pendingSubmissionCount ?? 0)
      : undefined;
  const workspaceName = subject ? getLocalizedSubjectName(subject, locale) : null;
  const showTerminate = formalRoom && canTerminate && room && ["published", "active"].includes(room.state);
  const backgroundSyncFailed = roomQuery.isError && roomQuery.data !== undefined && currentAccessFailure === null;
  const loadErrorDescription = currentAccessFailure?.status === 403
    ? t.permissionError
    : currentAccessFailure?.status === 404
      ? t.notFoundError
      : currentAccessFailure?.status === 401
        ? t.sessionError
        : t.loadErrorDescription;
  const lastUpdatedAt = roomQuery.dataUpdatedAt > 0 ? new Date(roomQuery.dataUpdatedAt) : null;

  return (
    <AdminShell
      activeNavigationKey="rooms"
      session={session}
      subject={subject}
      workspaceLabel={workspaceName ? `${workspaceName} · ${examCode}` : examCode}
    >
      <header className="routeHeader examRoomHeader">
        <div className="examRoomHeading">
          <h1>{room?.mode === "assignment" ? t.assignmentTitle : t.title}</h1>
          <span>{room ? <><span lang="und">{room.titleJa}</span> · {room.mode === "assignment" ? t.assignmentDescription : t.description}</> : examCode}</span>
        </div>
        <div className="examRoomHeaderActions">
          {lastUpdatedAt ? (
            <time className="examRoomSyncStatus" dateTime={lastUpdatedAt.toISOString()}>
              {t.lastUpdated(roomUpdatedAtFormatters[locale].format(lastUpdatedAt))}
            </time>
          ) : null}
          <code className="examRoomCode">{examCode}</code>
          <Link className="uiButton uiButtonSecondary" search={subject ? { subjectId: subject.id } : {}} to="/exams">{t.back}</Link>
          {showTerminate ? <Button onClick={() => setTerminationOpen(true)} variant="danger">{t.terminate}</Button> : null}
          <Button disabled={manualRefreshPending || currentAccessFailure !== null} onClick={() => void refresh()} variant="secondary">
            {manualRefreshPending ? t.refreshing : t.refresh}
          </Button>
        </div>
      </header>

      <div className="examRoomFlow">
        {roomQuery.isLoading && !currentAccessFailure ? <PageSkeleton label={t.loading} rows={9} /> : null}
        {currentAccessFailure || (roomQuery.isError && !roomQuery.data) ? (
          <QueryErrorState
            description={loadErrorDescription}
            onRetry={() => {
              if (currentAccessFailure?.status === 401) globalThis.location.replace("/admin/login/");
              else if (currentAccessFailure) setAccessFailureState(null);
              else void roomQuery.refetch();
            }}
            retryLabel={t.retry}
            title={t.loadError}
          />
        ) : null}
        {room ? (
          <>
            {backgroundSyncFailed ? <InlineFeedback tone="error">{t.syncError}</InlineFeedback> : null}
            <RoomSummary locale={locale} metrics={summaryMetrics} />
            {formalRoom && failuresQuery.isError && !failuresQueryAccessFailure ? <InlineFeedback tone="error">{t.failureSyncError}</InlineFeedback> : null}
            <TerminationFailuresPanel
              canRetry={canTerminate}
              failures={currentAccessFailure ? [] : failuresQuery.data ?? []}
              locale={locale}
              onRetry={setRetryFailureTarget}
              retryingAttemptId={retryFailureMutation.isPending ? retryFailureMutation.variables?.attemptId ?? null : null}
            />
            <section aria-label={t.title} className="roomOperationsPanel">
              <RoomFilterBar
                admissionPending={admissionPending}
                canManageAdmission={canManageAdmission}
                locale={locale}
                mode={room.mode}
                onAdmitSelected={handleAdmitSelected}
                onClearSelection={() => setSelectedStudentNumbers(new Set())}
                onQueryChange={handleQueryChange}
                onSelectAllWaiting={() => setSelectedStudentNumbers(new Set(selectableWaitingStudentNumbers(visibleStudents)))}
                onStatusChange={handleStatusChange}
                query={search.query ?? ""}
                selectableWaitingCount={selectableWaitingStudentNumbers(visibleStudents).length}
                selectedCount={selectedVisibleCount}
                status={activeStatus}
                students={students}
              />
              <AttendanceTable
                admissionPending={admissionPending}
                canAuthorizeResume={canAuthorizeResume}
                canAuthorizeRetake={canAuthorizeRetake}
                canManageAdmission={canManageAdmission}
                hasActiveFilters={Boolean(search.query || search.status)}
                locale={locale}
                mode={room.mode}
                onAdmit={handleAdmit}
                onClearFilters={handleClearFilters}
                onSelect={handleSelect}
                onStudentAction={setStudentActionTarget}
                pendingAction={pendingAction}
                selectedStudentNumbers={selectedStudentNumbers}
                status={activeStatus}
                students={visibleStudents}
                violationLimit={snapshot?.violationLimit ?? 3}
              />
            </section>
          </>
        ) : null}
      </div>

      <RoomActionDialog
        locale={locale}
        onCancel={() => setStudentActionTarget(null)}
        onConfirm={handleStudentActionConfirm}
        pending={actionDialogPending}
        target={currentAccessFailure ? null : studentActionTarget}
      />
      <RoomFailureRetryDialog
        failure={currentAccessFailure ? null : retryFailureTarget}
        locale={locale}
        onCancel={() => setRetryFailureTarget(null)}
        onConfirm={handleRetryFailure}
        pending={retryFailureMutation.isPending}
      />
      <DestructiveConfirmDialog
        cancelLabel={t.cancel}
        confirmLabel={t.terminateConfirm}
        description={t.terminateDescription}
        objectLabel={examCode}
        onCancel={() => {
          if (!roomTerminating) setTerminationOpen(false);
        }}
        onConfirm={handleTerminate}
        open={currentAccessFailure ? false : terminationOpen}
        pending={roomTerminating}
        pendingLabel={t.terminatePending}
        {...(progressLabel ? { progress: progressLabel } : {})}
        title={t.terminateTitle}
      />
    </AdminShell>
  );
}
