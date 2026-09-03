import { useQuery } from "@tanstack/react-query";
import { createLazyRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { AdminShell } from "../../../app/layouts/AdminShell.tsx";
import { useAdminLocale } from "../../../shared/i18n/AdminLocaleProvider.tsx";
import { EmptyState, PageSkeleton, QueryErrorState } from "../../../shared/patterns/PageStates.tsx";
import { Button } from "../../../shared/ui/Button.tsx";
import { subjectCatalogQueryOptions } from "../api/subjectQueries.ts";
import { SubjectEditorDialog } from "../components/SubjectEditorDialog.tsx";
import { SubjectStatusDialog } from "../components/SubjectStatusDialog.tsx";
import { SubjectTable, type SubjectActionTarget } from "../components/SubjectTable.tsx";
import { subjectCopy } from "../subjectCopy.ts";
import "../subjects.css";

export const Route = createLazyRoute("/subjects")({ component: SubjectsPage });

function SubjectsPage() {
  const { locale } = useAdminLocale();
  const { session } = Route.useLoaderData();
  const query = useQuery(subjectCatalogQueryOptions());
  const [creating, setCreating] = useState(false);
  const [actionTarget, setActionTarget] = useState<SubjectActionTarget | null>(null);
  const t = subjectCopy[locale];
  const subjects = query.data ?? [];

  return (
    <AdminShell activeNavigationKey="subjects" session={session} workspaceLabel={t.workspace}>
      <header className="routeHeader subjectRouteHeader">
        <div><h1>{t.title}</h1><p>{t.description}</p></div>
        <div className="routeHeaderActions">
          <Button disabled={query.isFetching} onClick={() => void query.refetch()} variant="secondary">{query.isFetching ? t.refreshing : t.refresh}</Button>
          <Button onClick={() => setCreating(true)} variant="primary">{t.create}</Button>
        </div>
      </header>

      <div className="subjectPageFlow">
        {query.isLoading ? <PageSkeleton rows={8} /> : null}
        {query.isError ? <QueryErrorState description={t.loadErrorDescription} onRetry={() => void query.refetch()} retryLabel={t.retry} title={t.loadError} /> : null}
        {!query.isLoading && !query.isError ? (
          <section aria-labelledby="subjectDirectoryTitle" className="subjectDirectory">
            <header className="subjectDirectoryHeader"><h2 id="subjectDirectoryTitle">{t.directory}</h2><span>{t.total(subjects.length)}</span></header>
            {subjects.length > 0 ? <SubjectTable locale={locale} onAction={setActionTarget} subjects={subjects} /> : (
              <EmptyState action={<Button onClick={() => setCreating(true)} variant="primary">{t.create}</Button>} description={t.emptyDescription} title={t.empty} />
            )}
          </section>
        ) : null}
      </div>

      {creating ? <SubjectEditorDialog csrfToken={session.csrfToken} locale={locale} onClose={() => setCreating(false)} onComplete={() => {
        setCreating(false);
        toast.success(t.created);
      }} /> : null}
      {actionTarget?.action === "edit" ? <SubjectEditorDialog csrfToken={session.csrfToken} key={actionTarget.subject.id} locale={locale} onClose={() => setActionTarget(null)} onComplete={() => {
        setActionTarget(null);
        toast.success(t.updated);
      }} subject={actionTarget.subject} /> : null}
      {actionTarget?.action === "status" ? <SubjectStatusDialog csrfToken={session.csrfToken} key={`${actionTarget.subject.id}:${actionTarget.subject.status}`} locale={locale} onClose={() => setActionTarget(null)} onComplete={() => {
        const wasActive = actionTarget.subject.status === "active";
        setActionTarget(null);
        toast.success(wasActive ? t.archived : t.restored);
      }} subject={actionTarget.subject} /> : null}
    </AdminShell>
  );
}
