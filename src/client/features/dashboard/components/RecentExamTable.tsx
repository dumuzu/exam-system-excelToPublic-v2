import { Link } from "@tanstack/react-router";
import { useMemo } from "react";

import type { AdminLocale } from "../../../shared/i18n/AdminLocaleProvider.tsx";
import { EmptyState } from "../../../shared/patterns/PageStates.tsx";
import { DataTable, type DataTableColumn } from "../../../shared/patterns/DataTable.tsx";
import type { DashboardExam } from "../types.ts";
import { ExamStatusBadge } from "./ExamStatusBadge.tsx";

function formatDate(value: string, locale: AdminLocale): string {
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : locale === "en" ? "en-GB" : "ja-JP", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function RecentExamTable({ exams, locale }: { exams: readonly DashboardExam[]; locale: AdminLocale }) {
  const visibleExams = useMemo(() => exams.slice(0, 8), [exams]);
  const columns = useMemo<readonly DataTableColumn<DashboardExam>[]>(() => [
    {
      id: "exam",
      header: locale === "ja" ? "試験" : locale === "zh" ? "考试" : "Exam",
      cell: ({ row }) => <><strong>{row.original.titleJa}</strong><code>{row.original.code}</code></>,
    },
    { id: "status", header: locale === "ja" ? "状態" : locale === "zh" ? "状态" : "Status", cell: ({ row }) => <ExamStatusBadge locale={locale} status={row.original.state} /> },
    { id: "roster", header: locale === "ja" ? "名簿" : locale === "zh" ? "名册" : "Roster", meta: { cellClassName: "numericCell" }, cell: ({ row }) => row.original.rosterCount },
    { id: "submitted", header: locale === "ja" ? "提出" : locale === "zh" ? "已提交" : "Submitted", meta: { cellClassName: "numericCell" }, cell: ({ row }) => row.original.submittedCount },
    { id: "created", header: locale === "ja" ? "作成日時" : locale === "zh" ? "创建时间" : "Created", cell: ({ row }) => formatDate(row.original.createdAt, locale) },
    {
      id: "action",
      header: locale === "en" ? "Actions" : "操作",
      cell: ({ row }) => (
        <Link aria-label={`${row.original.titleJa} room`} className="tableLink" params={{ examCode: row.original.code }} search={{}} to="/exams/$examCode/room">→</Link>
      ),
    },
  ], [locale]);

  if (exams.length === 0) {
    return (
      <EmptyState
        description={locale === "ja" ? "この科目にはまだ試験がありません。出題設定から最初の試験を作成できます。" : locale === "zh" ? "这个科目还没有考试，可以从出卷设置创建第一场考试。" : "This subject has no exams yet. Create the first one from Authoring."}
        title={locale === "ja" ? "試験データがありません" : locale === "zh" ? "暂无考试数据" : "No exam data"}
      />
    );
  }
  return <DataTable ariaLabel={locale === "ja" ? "最近の試験" : locale === "zh" ? "最近的考试" : "Recent exams"} columns={columns} getRowId={(exam) => exam.code} rows={visibleExams} />;
}
