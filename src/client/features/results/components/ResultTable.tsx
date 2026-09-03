import { useMemo } from "react";

import type { AdminLocale } from "../../../shared/i18n/AdminLocaleProvider.tsx";
import { DataTable, type DataTableColumn } from "../../../shared/patterns/DataTable.tsx";
import { Button } from "../../../shared/ui/Button.tsx";
import type { ResultSummary } from "../types.ts";
import { ResultStatusBadge } from "./ResultStatusBadge.tsx";

const labels = {
  ja: { table: "学生別成績", student: "学生", score: "最高得点", attempts: "受験回数", submitted: "提出時刻", audit: "警告 / 停止 / 回収", status: "状態", review: "答案を確認" },
  zh: { table: "学生成绩", student: "学生", score: "最高成绩", attempts: "考试次数", submitted: "交卷时间", audit: "警告 / 暂停 / 回收", status: "状态", review: "校对答案" },
  en: { table: "Student results", student: "Student", score: "Highest score", attempts: "Attempts", submitted: "Submitted at", audit: "Warnings / suspensions / collections", status: "Status", review: "Review answers" },
} as const;

const submittedAtFormatters: Record<AdminLocale, Intl.DateTimeFormat> = {
  ja: new Intl.DateTimeFormat("ja-JP", { dateStyle: "short", timeStyle: "short" }),
  zh: new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "short" }),
  en: new Intl.DateTimeFormat("en-GB", { dateStyle: "short", timeStyle: "short" }),
};

function formatSubmittedAt(value: string | null, locale: AdminLocale): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : submittedAtFormatters[locale].format(date);
}

export function ResultTable({ locale, onReview, results }: {
  locale: AdminLocale;
  onReview: (result: ResultSummary) => void;
  results: readonly ResultSummary[];
}) {
  const t = labels[locale];
  const columns = useMemo<readonly DataTableColumn<ResultSummary>[]>(() => [
    {
      id: "student",
      header: t.student,
      cell: ({ row }) => <span className="studentIdentity"><strong>{row.original.name}</strong><code>{row.original.studentNumber}</code></span>,
    },
    {
      id: "score",
      header: t.score,
      meta: { cellClassName: "resultMetricCell numericCell", headerClassName: "resultMetricHeader" },
      cell: ({ row }) => row.original.highestScore === null || row.original.highestMaximumScore === null
        ? "—"
        : `${row.original.highestScore} / ${row.original.highestMaximumScore}`,
    },
    { id: "attempts", header: t.attempts, meta: { cellClassName: "resultMetricCell numericCell", headerClassName: "resultMetricHeader" }, cell: ({ row }) => row.original.attemptCount },
    {
      id: "submitted",
      header: t.submitted,
      meta: { cellClassName: "resultSubmittedCell numericCell", headerClassName: "resultMetricHeader" },
      cell: ({ row }) => row.original.submittedAt
        ? <time dateTime={row.original.submittedAt}>{formatSubmittedAt(row.original.submittedAt, locale)}</time>
        : "—",
    },
    {
      id: "audit",
      header: t.audit,
      meta: { cellClassName: "resultMetricCell numericCell", headerClassName: "resultMetricHeader" },
      cell: ({ row }) => `${row.original.warningCount} / ${row.original.policySuspensionCount} / ${row.original.forcedSubmissionCount}`,
    },
    { id: "status", header: t.status, meta: { cellClassName: "resultStatusCell", headerClassName: "resultMetricHeader" }, cell: ({ row }) => <ResultStatusBadge locale={locale} result={row.original} /> },
    {
      id: "review",
      header: () => <span className="visuallyHidden">{t.review}</span>,
      meta: { cellClassName: "resultActionCell", headerClassName: "resultMetricHeader", mobileLabel: t.review },
      cell: ({ row }) => (
        <Button disabled={!row.original.submittedAt} onClick={() => onReview(row.original)} variant="quiet">{t.review}</Button>
      ),
    },
  ], [locale, onReview, t]);

  return (
    <DataTable
      ariaLabel={t.table}
      columns={columns}
      getRowId={(result) => result.studentNumber}
      rows={results}
    />
  );
}
