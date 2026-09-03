import { useMemo } from "react";

import type { AdminLocale } from "../../../shared/i18n/AdminLocaleProvider.tsx";
import { getLocalizedSubjectName } from "../../../shared/i18n/subjectNames.ts";
import { DataTable, type DataTableColumn } from "../../../shared/patterns/DataTable.tsx";
import { Button } from "../../../shared/ui/Button.tsx";
import { accountCopy } from "../accountCopy.ts";
import type { ManagedAccount, ManagedSubject } from "../../../../types/contracts/account-administration.ts";
import type { AccountActionKind } from "../types.ts";
import { AccountRoleBadge, AccountStatusBadge } from "./AccountStatusBadge.tsx";

export interface AccountActionTarget {
  account: ManagedAccount;
  action: AccountActionKind;
}
export function AccountTable({ accounts, locale, onAction, subjects }: {
  accounts: readonly ManagedAccount[];
  locale: AdminLocale;
  onAction: (target: AccountActionTarget) => void;
  subjects: readonly ManagedSubject[];
}) {
  const t = accountCopy[locale];
  const subjectNames = useMemo(
    () => new Map(subjects.map((subject) => [subject.id, getLocalizedSubjectName(subject, locale)])),
    [locale, subjects],
  );
  const columns = useMemo<readonly DataTableColumn<ManagedAccount>[]>(() => [
    {
      id: "identity",
      header: t.identity,
      cell: ({ row }) => <span className="accountIdentity"><strong>{row.original.displayName}</strong><code>{row.original.username}</code></span>,
    },
    { id: "status", header: t.status, cell: ({ row }) => <AccountStatusBadge locale={locale} status={row.original.status} /> },
    { id: "role", header: t.role, cell: ({ row }) => <AccountRoleBadge locale={locale} role={row.original.platformRole} /> },
    {
      id: "memberships",
      header: t.memberships,
      cell: ({ row }) => row.original.memberships.length > 0 ? (
        <ul className="accountMembershipList">
          {row.original.memberships.map((membership) => (
            <li key={membership.subjectId}>
              <strong>{subjectNames.get(membership.subjectId) ?? membership.subjectName}</strong>
              <span>{t[membership.subjectRole]}</span>
            </li>
          ))}
        </ul>
      ) : <span className="accountEmptyMembership">{t.noMemberships}</span>,
    },
    {
      id: "actions",
      header: t.actions,
      cell: ({ row }) => (
        <span className="accountTableActions">
          <Button onClick={() => onAction({ account: row.original, action: "membership" })} variant="quiet">{t.assign}</Button>
          <Button onClick={() => onAction({ account: row.original, action: "password" })} variant="quiet">{t.resetPassword}</Button>
          <Button onClick={() => onAction({ account: row.original, action: "role" })} variant="quiet">
            {row.original.platformRole === "super_admin" ? t.demote : t.promote}
          </Button>
          <Button className={row.original.status === "disabled" ? "" : "tableDangerAction"} onClick={() => onAction({ account: row.original, action: "status" })} variant="quiet">
            {row.original.status === "disabled" ? t.enable : t.disable}
          </Button>
        </span>
      ),
    },
  ], [locale, onAction, subjectNames, t]);

  return <DataTable ariaLabel={t.title} columns={columns} getRowId={(account) => account.id} rows={accounts} />;
}
