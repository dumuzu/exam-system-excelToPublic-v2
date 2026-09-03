import { useQuery } from "@tanstack/react-query";
import { createLazyRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { AdminShell } from "../../../app/layouts/AdminShell.tsx";
import { useAdminLocale } from "../../../shared/i18n/AdminLocaleProvider.tsx";
import { EmptyState, PageSkeleton, QueryErrorState } from "../../../shared/patterns/PageStates.tsx";
import { PaginationBar } from "../../../shared/patterns/PaginationBar.tsx";
import { Button } from "../../../shared/ui/Button.tsx";
import { accountCopy } from "../accountCopy.ts";
import { accountPageQueryOptions, managedSubjectQueryOptions } from "../api/accountQueries.ts";
import { AccountActionDialog } from "../components/AccountActionDialog.tsx";
import { AccountTable, type AccountActionTarget } from "../components/AccountTable.tsx";
import { CreateAccountDialog } from "../components/CreateAccountDialog.tsx";
import "../accounts.css";

export const Route = createLazyRoute("/accounts")({ component: AccountsPage });

const pageSize = 20;

function AccountsPage() {
  const { locale } = useAdminLocale();
  const { session } = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const accountQuery = useQuery(accountPageQueryOptions(search.page ?? 1, pageSize));
  const subjectQuery = useQuery(managedSubjectQueryOptions());
  const [creating, setCreating] = useState(false);
  const [actionTarget, setActionTarget] = useState<AccountActionTarget | null>(null);
  const t = accountCopy[locale];
  const loading = accountQuery.isLoading || subjectQuery.isLoading;
  const failed = accountQuery.isError || subjectQuery.isError;
  const refreshing = accountQuery.isFetching || subjectQuery.isFetching;
  const accountPage = accountQuery.data;
  const subjects = subjectQuery.data ?? [];

  const retry = () => {
    void Promise.all([accountQuery.refetch(), subjectQuery.refetch()]);
  };

  return (
    <AdminShell activeNavigationKey="accounts" session={session} workspaceLabel={t.workspace}>
      <header className="routeHeader accountRouteHeader">
        <div>
          <h1>{t.title}</h1>
          <p>{t.description}</p>
        </div>
        <div className="routeHeaderActions">
          <Button disabled={refreshing} onClick={retry} variant="secondary">{refreshing ? t.refreshing : t.refresh}</Button>
          <Button onClick={() => setCreating(true)} variant="primary">{t.create}</Button>
        </div>
      </header>

      <div className="accountPageFlow">
        {loading ? <PageSkeleton rows={8} /> : null}
        {failed ? <QueryErrorState description={t.loadErrorDescription} onRetry={retry} retryLabel={t.retry} title={t.loadError} /> : null}
        {!loading && !failed && accountPage ? (
          <section aria-labelledby="accountDirectoryTitle" className="accountDirectory">
            <header className="accountDirectoryHeader">
              <h2 id="accountDirectoryTitle">{t.title}</h2>
              <span>{t.total(accountPage.pagination.total)}</span>
            </header>
            {accountPage.accounts.length > 0 ? (
              <AccountTable accounts={accountPage.accounts} locale={locale} onAction={setActionTarget} subjects={subjects} />
            ) : <EmptyState description={t.emptyDescription} title={t.empty} />}
            <PaginationBar
              currentPage={accountPage.pagination.page}
              label={t.pagination}
              nextLabel={t.next}
              onPageChange={(page) => void navigate({ search: page > 1 ? { page } : {}, replace: true })}
              previousLabel={t.previous}
              totalPages={accountPage.pagination.totalPages}
            />
          </section>
        ) : null}
      </div>

      {creating ? (
        <CreateAccountDialog
          csrfToken={session.csrfToken}
          locale={locale}
          onClose={() => setCreating(false)}
          onComplete={() => {
            setCreating(false);
            toast.success(t.created);
            void navigate({ search: {}, replace: true });
          }}
        />
      ) : null}
      {actionTarget ? (
        <AccountActionDialog
          csrfToken={session.csrfToken}
          key={`${actionTarget.account.id}:${actionTarget.action}`}
          locale={locale}
          onClose={() => setActionTarget(null)}
          onComplete={() => {
            setActionTarget(null);
            toast.success(t.updated);
          }}
          subjects={subjects}
          target={actionTarget}
        />
      ) : null}
    </AdminShell>
  );
}
