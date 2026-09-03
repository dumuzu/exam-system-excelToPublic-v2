import { createLazyRoute } from "@tanstack/react-router";

import { AdminShell } from "../../../app/layouts/AdminShell.tsx";
import { useAdminLocale } from "../../../shared/i18n/AdminLocaleProvider.tsx";
import { EmptyState } from "../../../shared/patterns/PageStates.tsx";
import { authoringCopy } from "../copy.ts";
import { AuthoringWorkspace } from "../components/AuthoringWorkspace.tsx";
import "../examAuthoring.css";

export const Route = createLazyRoute("/exams/new")({ component: AuthoringPage });

function AuthoringPage() {
  const { locale } = useAdminLocale();
  const { assessmentTypeKey, session, subjectId } = Route.useLoaderData();
  const navigate = Route.useNavigate();
  const subject = session.workspaceSubjects.find((item) => item.id === subjectId) ?? null;
  const t = authoringCopy[locale];
  const changeSubject = (nextSubjectId: string) => {
    const nextSubject = session.workspaceSubjects.find((item) => item.id === nextSubjectId);
    void navigate({ search: { subjectId: nextSubjectId, assessmentTypeKey: nextSubject?.assessmentTypeKeys[0] }, replace: true });
  };

  return (
    <AdminShell activeNavigationKey="compose" onSubjectChange={changeSubject} session={session} subject={subject}>
      <header className="routeHeader authoringRouteHeader"><h1>{t.title}</h1></header>
      {subject ? (
        <AuthoringWorkspace
          assessmentTypeKey={assessmentTypeKey}
          csrfToken={session.csrfToken}
          key={`${subject.id}:${assessmentTypeKey}`}
          locale={locale}
          onAssessmentTypeChange={(nextAssessmentTypeKey) => void navigate({
            search: { assessmentTypeKey: nextAssessmentTypeKey, subjectId: subject.id },
            replace: true,
          })}
          subject={subject}
        />
      ) : (
        <EmptyState description={t.noSubjectDescription} title={t.noSubject} />
      )}
    </AdminShell>
  );
}
