import { Link } from "@tanstack/react-router";
import { useMemo } from "react";

import type { AdminLocale } from "../../../shared/i18n/AdminLocaleProvider.tsx";
import { DataTable, type DataTableColumn } from "../../../shared/patterns/DataTable.tsx";
import { Button } from "../../../shared/ui/Button.tsx";
import type { ExamEvent } from "../types.ts";
import { ExamEventStatusBadge } from "./ExamEventStatusBadge.tsx";

function formatDate(value: string, locale: AdminLocale): string {
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : locale === "en" ? "en-GB" : "ja-JP", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function modeLabel(mode: string, locale: AdminLocale): string {
  const labels: Record<string, Record<AdminLocale, string>> = {
    assignment: { ja: "課題", zh: "课堂课题", en: "Assignment" },
    exam: { ja: "正式試験", zh: "正式考试", en: "Exam" },
    formal: { ja: "正式試験", zh: "正式考试", en: "Exam" },
  };
  return labels[mode]?.[locale] ?? mode;
}

function preparationLabel(status: string, locale: AdminLocale): string {
  const labels: Record<string, Record<AdminLocale, string>> = {
    ready: { ja: "準備完了", zh: "准备完成", en: "Ready" },
    pending: { ja: "準備待ち", zh: "等待准备", en: "Pending" },
    processing: { ja: "準備中", zh: "准备中", en: "Preparing" },
    failed: { ja: "準備失敗", zh: "准备失败", en: "Failed" },
  };
  return labels[status]?.[locale] ?? status;
}

export function ExamEventTable({ canDelete, canTerminate, exams, locale, onDelete, onTerminate }: {
  canDelete: boolean;
  canTerminate: boolean;
  exams: readonly ExamEvent[];
  locale: AdminLocale;
  onDelete: (exam: ExamEvent) => void;
  onTerminate: (exam: ExamEvent) => void;
}) {
  const columns = useMemo<readonly DataTableColumn<ExamEvent>[]>(() => [
    {
      id: "exam",
      header: locale === "ja" ? "試験" : locale === "zh" ? "考试" : "Exam",
      meta: { cellClassName: "examIdentityCell", headerClassName: "examIdentityCell" },
      cell: ({ row }) => (
        <span className="examIdentity">
          <strong>{row.original.titleJa}</strong>
          <small>{row.original.code} · {modeLabel(row.original.mode, locale)} · {preparationLabel(row.original.preparationStatus, locale)}</small>
        </span>
      ),
    },
    { id: "status", header: locale === "ja" ? "状態" : locale === "zh" ? "状态" : "Status", meta: { cellClassName: "examStatusCell", headerClassName: "examStatusCell" }, cell: ({ row }) => <ExamEventStatusBadge exam={row.original} locale={locale} /> },
    { id: "roster", header: locale === "ja" ? "名簿" : locale === "zh" ? "名册" : "Roster", meta: { cellClassName: "numericCell examMetricCell", headerClassName: "examMetricCell" }, cell: ({ row }) => row.original.rosterCount },
    { id: "waiting", header: locale === "ja" ? "確認待ち" : locale === "zh" ? "等待确认" : "Waiting", meta: { cellClassName: "numericCell examMetricCell", headerClassName: "examMetricCell" }, cell: ({ row }) => row.original.waitingCount },
    { id: "running", header: locale === "ja" ? "受験中" : locale === "zh" ? "考试中" : "In progress", meta: { cellClassName: "numericCell examMetricCell", headerClassName: "examMetricCell" }, cell: ({ row }) => row.original.inProgressCount },
    { id: "submitted", header: locale === "ja" ? "提出" : locale === "zh" ? "已提交" : "Submitted", meta: { cellClassName: "numericCell examMetricCell", headerClassName: "examMetricCell" }, cell: ({ row }) => row.original.submittedCount },
    { id: "created", header: locale === "ja" ? "作成日時" : locale === "zh" ? "创建时间" : "Created", meta: { cellClassName: "examCreatedCell", headerClassName: "examCreatedCell" }, cell: ({ row }) => formatDate(row.original.createdAt, locale) },
    {
      id: "actions",
      header: locale === "en" ? "Actions" : "操作",
      meta: { cellClassName: "examActionCell", headerClassName: "examActionCell" },
      cell: ({ row }) => (
        <span className="tableActionGroup">
          <Link className="tableTextLink" params={{ examCode: row.original.code }} search={{}} to="/exams/$examCode/room">{locale === "ja" ? "開く" : locale === "zh" ? "打开" : "Open"}</Link>
          {canTerminate && row.original.state !== "closed" && row.original.state !== "archived" ? (
            <Button className="tableDangerAction" onClick={() => onTerminate(row.original)} variant="quiet">{locale === "en" ? "Terminate" : "中止"}</Button>
          ) : null}
          {canDelete ? (
            <Button className="tableDangerAction" onClick={() => onDelete(row.original)} variant="quiet">{locale === "ja" ? "削除" : locale === "zh" ? "删除" : "Delete"}</Button>
          ) : null}
        </span>
      ),
    },
  ], [canDelete, canTerminate, locale, onDelete, onTerminate]);

  return <DataTable ariaLabel={locale === "ja" ? "試験イベント一覧" : locale === "zh" ? "考试事件列表" : "Exam events"} columns={columns} getRowId={(exam) => exam.code} rows={exams} />;
}
