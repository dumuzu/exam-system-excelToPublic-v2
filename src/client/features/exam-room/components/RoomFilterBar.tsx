import type { KeyboardEvent } from "react";

import type { AssessmentMode } from "../../../../types/models/assessment.ts";
import type { ExamRoomStudent } from "../../../../types/contracts/exam-room.ts";
import type { AdminLocale } from "../../../shared/i18n/AdminLocaleProvider.tsx";
import { Button } from "../../../shared/ui/Button.tsx";
import { TextField } from "../../../shared/ui/TextField.tsx";
import { examRoomCopy } from "../copy.ts";
import { roomStatusTabs, visibleStudentStatus } from "../model/roomView.ts";
import type { RoomStatusFilter, RoomVisibleStatus } from "../types.ts";

const attendancePanelId = "roomAttendancePanel";

function tabId(status: RoomStatusFilter): string {
  return `roomFilterTab-${status ?? "all"}`;
}

export function RoomFilterBar({
  admissionPending,
  canManageAdmission,
  locale,
  mode,
  onAdmitSelected,
  onClearSelection,
  onQueryChange,
  onSelectAllWaiting,
  onStatusChange,
  query,
  selectableWaitingCount,
  selectedCount,
  status,
  students,
}: {
  admissionPending: boolean;
  canManageAdmission: boolean;
  locale: AdminLocale;
  mode: AssessmentMode;
  onAdmitSelected: () => void;
  onClearSelection: () => void;
  onQueryChange: (query: string) => void;
  onSelectAllWaiting: () => void;
  onStatusChange: (status: RoomStatusFilter) => void;
  query: string;
  selectableWaitingCount: number;
  selectedCount: number;
  status: RoomStatusFilter;
  students: readonly ExamRoomStudent[];
}) {
  const t = examRoomCopy[locale];
  const isAssignment = mode === "assignment";
  const statusCounts = new Map<RoomVisibleStatus, number>();
  for (const student of students) {
    const visibleStatus = visibleStudentStatus(student, mode);
    statusCounts.set(visibleStatus, (statusCounts.get(visibleStatus) ?? 0) + 1);
  }
  const tabs: readonly RoomStatusFilter[] = [undefined, ...roomStatusTabs(mode)];
  const activeStatus = tabs.includes(status) ? status : undefined;

  const moveTabFocus = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const buttons = [...(event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? [])];
    const currentIndex = buttons.indexOf(event.currentTarget);
    if (currentIndex < 0 || buttons.length === 0) return;
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? buttons.length - 1
        : (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
    event.preventDefault();
    buttons[nextIndex]?.focus();
    onStatusChange(tabs[nextIndex]);
  };

  return (
    <>
      <div className="roomToolbar">
        <TextField
          autoComplete="off"
          className="roomSearch"
          id="roomStudentSearch"
          label={t.search}
          onChange={(event) => onQueryChange(event.currentTarget.value)}
          placeholder={t.searchPlaceholder}
          type="search"
          value={query}
        />
        {!isAssignment ? (
          <div className="roomToolbarNote">
            <strong>{t.rollCallTitle}</strong>
            <span>{t.rollCallDescription}</span>
          </div>
        ) : null}
        {!isAssignment && canManageAdmission ? (
          <>
            <Button
              aria-busy={admissionPending}
              disabled={admissionPending || selectableWaitingCount === 0}
              onClick={onSelectAllWaiting}
              variant="secondary"
            >
              {t.selectAllWaiting(selectableWaitingCount)}
            </Button>
            {selectedCount > 0 ? (
              <Button disabled={admissionPending} onClick={onClearSelection} variant="quiet">
                {t.clearSelection(selectedCount)}
              </Button>
            ) : null}
            <Button
              aria-busy={admissionPending}
              disabled={admissionPending || selectedCount === 0}
              onClick={onAdmitSelected}
              variant="primary"
            >
              {t.admitSelected(selectedCount)}
            </Button>
          </>
        ) : null}
      </div>
      <div aria-label={t.status} className="roomFilterTabs" role="tablist">
        {tabs.map((tabStatus) => {
          const active = tabStatus === activeStatus;
          const count = tabStatus ? statusCounts.get(tabStatus) ?? 0 : students.length;
          return (
            <button
              aria-controls={attendancePanelId}
              aria-selected={active}
              className="roomFilterTab"
              id={tabId(tabStatus)}
              key={tabStatus ?? "all"}
              onClick={() => onStatusChange(tabStatus)}
              onKeyDown={moveTabFocus}
              role="tab"
              tabIndex={active ? 0 : -1}
              type="button"
            >
              {tabStatus ? t.statusLabels[tabStatus] : t.allStatuses} {count}
            </button>
          );
        })}
      </div>
    </>
  );
}

export function roomFilterTabId(status: RoomStatusFilter): string {
  return tabId(status);
}

export const roomAttendancePanelId = attendancePanelId;
