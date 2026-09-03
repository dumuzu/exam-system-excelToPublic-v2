import { useMemo } from "react";

import type { ManagedSubject } from "../../../../types/contracts/account-administration.ts";
import type { AdminLocale } from "../../../shared/i18n/AdminLocaleProvider.tsx";
import { getLocalizedSubjectName } from "../../../shared/i18n/subjectNames.ts";
import { DataTable, type DataTableColumn } from "../../../shared/patterns/DataTable.tsx";
import { Badge } from "../../../shared/ui/Badge.tsx";
import { Button } from "../../../shared/ui/Button.tsx";
import { subjectCopy } from "../subjectCopy.ts";

export type SubjectActionTarget = {
  action: "edit" | "status";
  subject: ManagedSubject;
};

export function SubjectTable({ locale, onAction, subjects }: {
  locale: AdminLocale;
  onAction: (target: SubjectActionTarget) => void;
  subjects: readonly ManagedSubject[];
}) {
  const t = subjectCopy[locale];
  const columns = useMemo<readonly DataTableColumn<ManagedSubject>[]>(() => [
    {
      id: "subject",
      header: t.subject,
      cell: ({ row }) => (
        <span className="subjectIdentity">
          <strong>{getLocalizedSubjectName(row.original, locale)}</strong>
          <code>{row.original.code}</code>
        </span>
      ),
    },
    {
      id: "status",
      header: t.status,
      cell: ({ row }) => <Badge tone={row.original.status === "active" ? "success" : "neutral"}>{row.original.status === "active" ? t.active : t.archivedStatus}</Badge>,
    },
    {
      id: "adapter",
      header: t.adapter,
      cell: ({ row }) => (
        <span className="subjectCapabilityList">
          {row.original.assessmentTypeKeys.map((key) => (
            <Badge key={key} tone="neutral">{key === "excel_formula" ? t.excel : t.manual}</Badge>
          ))}
        </span>
      ),
    },
    {
      id: "language",
      header: t.language,
      cell: ({ row }) => <Badge tone="neutral">{{
        legacy_bilingual: t.legacy,
        ja: t.japanese,
        zh: t.chinese,
        en: t.english,
      }[row.original.studentLocale]}</Badge>,
    },
    {
      id: "staff",
      header: t.staff,
      meta: { cellClassName: "subjectStaffCell" },
      cell: ({ row }) => row.original.membershipCount,
    },
    {
      id: "actions",
      header: t.actions,
      meta: { cellClassName: "subjectActionCell" },
      cell: ({ row }) => {
        const subject = row.original;
        const protectedSubject = subject.code === "excel-applications";
        return (
          <span className="subjectRowActions">
            <Button onClick={() => onAction({ action: "edit", subject })} variant="secondary">{t.edit}</Button>
            {protectedSubject && subject.status === "active" ? <span className="subjectProtectedLabel">{t.protected}</span> : (
              <Button onClick={() => onAction({ action: "status", subject })} variant={subject.status === "active" ? "quiet" : "secondary"}>
                {subject.status === "active" ? t.archive : t.restore}
              </Button>
            )}
          </span>
        );
      },
    },
  ], [locale, onAction, t]);

  return <DataTable ariaLabel={t.table} columns={columns} getRowId={(subject) => subject.id} rows={subjects} />;
}
