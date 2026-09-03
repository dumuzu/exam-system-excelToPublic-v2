import { useMemo } from "react";

import type { ManagedSubject } from "../../../../types/contracts/account-administration.ts";
import type { AdminLocale } from "../../../shared/i18n/AdminLocaleProvider.tsx";
import { getLocalizedSubjectName } from "../../../shared/i18n/subjectNames.ts";
import { DataTable, type DataTableColumn } from "../../../shared/patterns/DataTable.tsx";
import { Badge } from "../../../shared/ui/Badge.tsx";

export interface SubjectOperationsRow {
  subject: ManagedSubject;
  eventCount: number;
  activeCount: number;
  submittedCount: number;
}

export function SubjectOperationsTable({ locale, rows }: {
  locale: AdminLocale;
  rows: readonly SubjectOperationsRow[];
}) {
  const labels = useMemo(() => ({
    ja: { table: "科目別の運用状況", subject: "科目", language: "学生画面", legacy_bilingual: "現行の二言語", ja: "日本語", zh: "中国語", en: "英語", teachers: "担当者", events: "試験", active: "実施中", submitted: "提出" },
    zh: { table: "各科目当前状态", subject: "科目", language: "学生端", legacy_bilingual: "现有双语", ja: "日语", zh: "中文", en: "英语", teachers: "负责教师", events: "考试", active: "进行中", submitted: "已提交" },
    en: { table: "Subject operations", subject: "Subject", language: "Student interface", legacy_bilingual: "Current bilingual", ja: "Japanese", zh: "Chinese", en: "English", teachers: "Assigned staff", events: "Exams", active: "Active", submitted: "Submitted" },
  })[locale], [locale]);
  const columns = useMemo<readonly DataTableColumn<SubjectOperationsRow>[]>(() => [
    {
      id: "subject",
      header: labels.subject,
      cell: ({ row }) => (
        <span className="systemSubjectIdentity">
          <strong>{getLocalizedSubjectName(row.original.subject, locale)}</strong>
          <code>{row.original.subject.code}</code>
        </span>
      ),
    },
    { id: "language", header: labels.language, cell: ({ row }) => <Badge tone="neutral">{labels[row.original.subject.studentLocale]}</Badge> },
    { id: "teachers", header: labels.teachers, meta: { cellClassName: "systemCountCell" }, cell: ({ row }) => row.original.subject.membershipCount },
    { id: "events", header: labels.events, meta: { cellClassName: "systemCountCell" }, cell: ({ row }) => row.original.eventCount },
    {
      id: "active",
      header: labels.active,
      meta: { cellClassName: "systemCountCell" },
      cell: ({ row }) => row.original.activeCount > 0 ? <Badge tone="success">{row.original.activeCount}</Badge> : <span>0</span>,
    },
    { id: "submitted", header: labels.submitted, meta: { cellClassName: "systemCountCell" }, cell: ({ row }) => row.original.submittedCount },
  ], [labels, locale]);
  return <DataTable ariaLabel={labels.table} columns={columns} getRowId={(row) => row.subject.id} rows={rows} />;
}
