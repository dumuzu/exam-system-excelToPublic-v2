import { tableFeatures, useTable, type ColumnDef } from "@tanstack/react-table";
import { memo, useMemo } from "react";

import type { AssessmentMode } from "../../../../types/models/assessment.ts";
import type { ExamRoomStudent } from "../../../../types/contracts/exam-room.ts";
import type { AdminLocale } from "../../../shared/i18n/AdminLocaleProvider.tsx";
import { Button } from "../../../shared/ui/Button.tsx";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../../shared/ui/Table.tsx";
import { examRoomCopy } from "../copy.ts";
import {
  displayStudentName,
  isResumeEligible,
  isRetakeEligible,
  roomStatusTabs,
  visibleStudentStatus,
} from "../model/roomView.ts";
import type { RoomStatusFilter, RoomStudentActionTarget } from "../types.ts";
import { roomAttendancePanelId, roomFilterTabId } from "./RoomFilterBar.tsx";

type PendingStudentAction = "admit" | "resume" | "retake";
const attendanceTableFeatures = tableFeatures({});
type AttendanceColumn = ColumnDef<typeof attendanceTableFeatures, ExamRoomStudent>;

const timeFormatters: Record<AdminLocale, Intl.DateTimeFormat> = {
  ja: new Intl.DateTimeFormat("ja-JP", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }),
  zh: new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }),
  en: new Intl.DateTimeFormat("en-GB", { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" }),
};

function formatTime(value: string | null, locale: AdminLocale): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return timeFormatters[locale].format(date);
}

const AttendanceRow = memo(function AttendanceRow({
  admissionPending,
  canAuthorizeResume,
  canAuthorizeRetake,
  canManageAdmission,
  locale,
  mode,
  onAdmit,
  onSelect,
  onStudentAction,
  pendingAction,
  selected,
  student,
  violationLimit,
}: {
  admissionPending: boolean;
  canAuthorizeResume: boolean;
  canAuthorizeRetake: boolean;
  canManageAdmission: boolean;
  locale: AdminLocale;
  mode: AssessmentMode;
  onAdmit: (studentNumber: string) => void;
  onSelect: (studentNumber: string, selected: boolean) => void;
  onStudentAction: (target: RoomStudentActionTarget) => void;
  pendingAction: PendingStudentAction | null;
  selected: boolean;
  student: ExamRoomStudent;
  violationLimit: number;
}) {
  const t = examRoomCopy[locale];
  const isAssignment = mode === "assignment";
  const visibleStatus = visibleStudentStatus(student, mode);
  const activityAt = student.lastSeenAt ?? student.startedAt ?? student.arrivedAt;
  const timeValue = isAssignment ? activityAt : student.arrivedAt;
  const waiting = student.status === "waiting_approval";
  const rowPending = pendingAction !== null;

  return (
    <TableRow data-status={visibleStatus}>
      <TableCell data-label={t.student}>
        <span aria-hidden="true" className="roomMobileCellLabel">{t.student}</span>
        <div className="roomStudentIdentity">
          {waiting && canManageAdmission ? (
            <label className="roomSelectionControl">
              <input
                aria-label={`${student.studentNumber} ${t.rollCallTitle}`}
                checked={selected}
                disabled={admissionPending || rowPending}
                onChange={(event) => onSelect(student.studentNumber, event.currentTarget.checked)}
                type="checkbox"
              />
            </label>
          ) : <span aria-hidden="true" className="roomSelectionPlaceholder" />}
          <span className="roomStudentIdentityText">
            <strong>{student.studentNumber}</strong>
            <small lang="und">{displayStudentName(student.name)}</small>
          </span>
        </div>
      </TableCell>
      <TableCell data-label={t.status}>
        <span aria-hidden="true" className="roomMobileCellLabel">{t.status}</span>
        <span className="roomStatusCell">
          <span className="uiBadge roomStatusBadge" data-status={visibleStatus}>{t.statusLabels[visibleStatus]}</span>
          {!isAssignment ? <small className="roomCellDetail">{t.violations(student.violationCount, violationLimit)}</small> : null}
        </span>
      </TableCell>
      <TableCell data-label={isAssignment ? t.activity : t.arrival}>
        <span aria-hidden="true" className="roomMobileCellLabel">{isAssignment ? t.activity : t.arrival}</span>
        <span className="roomTimeCell">
          <time className="roomTimeValue" dateTime={timeValue ?? undefined}>{formatTime(timeValue, locale)}</time>
        </span>
      </TableCell>
      <TableCell data-label={t.submitted}>
        <span aria-hidden="true" className="roomMobileCellLabel">{t.submitted}</span>
        <span className="roomSubmittedCell">
          {student.submittedAt
            ? <time className="roomTimeValue" dateTime={student.submittedAt}>{formatTime(student.submittedAt, locale)}</time>
            : <span aria-label={t.submitted}>—</span>}
        </span>
      </TableCell>
      <TableCell data-label={t.attempts}>
        <span aria-hidden="true" className="roomMobileCellLabel">{t.attempts}</span>
        <span className="roomAttemptCell">
          <strong className="roomAttemptCount">{t.attemptCount(student.attemptCount)}</strong>
        </span>
      </TableCell>
      {!isAssignment ? (
        <TableCell data-label={t.actions}>
          <span aria-hidden="true" className="roomMobileCellLabel">{t.actions}</span>
          <span className="roomActionGroup">
            {waiting && canManageAdmission ? (
              <Button
                aria-label={`${t.admit} ${student.studentNumber}`}
                aria-busy={pendingAction === "admit"}
                className="roomActionButton"
                disabled={admissionPending || rowPending}
                onClick={() => onAdmit(student.studentNumber)}
                variant="secondary"
              >
                {t.admit}
              </Button>
            ) : null}
            {canAuthorizeResume && isResumeEligible(student) ? (
              <Button
                aria-label={`${t.resume} ${student.studentNumber}`}
                aria-busy={pendingAction === "resume"}
                className="roomActionButton"
                disabled={admissionPending || rowPending}
                onClick={() => onStudentAction({ action: "resume", student })}
                variant="secondary"
              >
                {t.resume}
              </Button>
            ) : null}
            {canAuthorizeRetake && isRetakeEligible(student) ? (
              <Button
                aria-label={`${t.retake} ${student.studentNumber}`}
                aria-busy={pendingAction === "retake"}
                className="roomActionButton"
                disabled={admissionPending || rowPending}
                onClick={() => onStudentAction({ action: "retake", student })}
                variant="quiet"
              >
                {t.retake}
              </Button>
            ) : null}
          </span>
        </TableCell>
      ) : null}
    </TableRow>
  );
});

export function AttendanceTable({
  admissionPending,
  canAuthorizeResume,
  canAuthorizeRetake,
  canManageAdmission,
  hasActiveFilters,
  locale,
  mode,
  onAdmit,
  onClearFilters,
  onSelect,
  onStudentAction,
  pendingAction,
  selectedStudentNumbers,
  status,
  students,
  violationLimit,
}: {
  admissionPending: boolean;
  canAuthorizeResume: boolean;
  canAuthorizeRetake: boolean;
  canManageAdmission: boolean;
  hasActiveFilters: boolean;
  locale: AdminLocale;
  mode: AssessmentMode;
  onAdmit: (studentNumber: string) => void;
  onClearFilters: () => void;
  onSelect: (studentNumber: string, selected: boolean) => void;
  onStudentAction: (target: RoomStudentActionTarget) => void;
  pendingAction: { action: PendingStudentAction; studentNumber: string } | null;
  selectedStudentNumbers: ReadonlySet<string>;
  status: RoomStatusFilter;
  students: readonly ExamRoomStudent[];
  violationLimit: number;
}) {
  const t = examRoomCopy[locale];
  const activeStatus = status && roomStatusTabs(mode).includes(status) ? status : undefined;
  const columns = useMemo<readonly AttendanceColumn[]>(() => [
    { id: "student", header: t.student },
    { id: "status", header: t.status },
    { id: "activity", header: mode === "assignment" ? t.activity : t.arrival },
    { id: "submitted", header: t.submitted },
    { id: "attempts", header: t.attempts },
    ...(mode === "assignment" ? [] : [{ id: "actions", header: t.actions } satisfies AttendanceColumn]),
  ], [locale, mode]);
  const table = useTable({
    columns,
    data: students,
    features: attendanceTableFeatures,
    getRowId: (student) => student.studentNumber,
  });

  return (
    <div
      aria-labelledby={roomFilterTabId(activeStatus)}
      className="roomTableViewport"
      id={roomAttendancePanelId}
      role="tabpanel"
      tabIndex={0}
    >
      {students.length === 0 ? (
        <div className="roomEmptyState" role="status">
          <p>{hasActiveFilters ? t.emptyFiltered : t.emptyRoster}</p>
          {hasActiveFilters ? <Button onClick={onClearFilters} variant="secondary">{t.clearFilters}</Button> : null}
        </div>
      ) : (
        <Table className="roomAttendanceTable">
          <TableCaption className="visuallyHidden">{t.student}</TableCaption>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id} scope="col">
                    {header.isPlaceholder ? null : <table.FlexRender header={header} />}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getCoreRowModel().rows.map((row) => (
              <AttendanceRow
                admissionPending={admissionPending}
                canAuthorizeResume={canAuthorizeResume}
                canAuthorizeRetake={canAuthorizeRetake}
                canManageAdmission={canManageAdmission}
                key={row.id}
                locale={locale}
                mode={mode}
                onAdmit={onAdmit}
                onSelect={onSelect}
                onStudentAction={onStudentAction}
                pendingAction={pendingAction?.studentNumber === row.original.studentNumber ? pendingAction.action : null}
                selected={selectedStudentNumbers.has(row.original.studentNumber)}
                student={row.original}
                violationLimit={violationLimit}
              />
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
