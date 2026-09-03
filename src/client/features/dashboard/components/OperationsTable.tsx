import { Link } from "@tanstack/react-router";

import type { AdminLocale } from "../../../shared/i18n/AdminLocaleProvider.tsx";
import type { AdminPermission, WorkspaceSubject } from "../../../../types/contracts/admin-auth.ts";

interface OperationDefinition {
  key: "compose" | "rooms" | "results";
  permission: AdminPermission;
  title: Record<AdminLocale, string>;
}

const operations: readonly OperationDefinition[] = [
  {
    key: "compose",
    permission: "compose_exam",
    title: { ja: "出題管理", zh: "出题管理", en: "Authoring" },
  },
  {
    key: "rooms",
    permission: "view_room",
    title: { ja: "考場管理", zh: "考场管理", en: "Exam rooms" },
  },
  {
    key: "results",
    permission: "view_results",
    title: { ja: "成績管理", zh: "成绩管理", en: "Results" },
  },
];

function OperationLink({ locale, operation, subjectId }: {
  locale: AdminLocale;
  operation: OperationDefinition;
  subjectId: string;
}) {
  const content = (
    <>
      <strong>{operation.title[locale]}</strong>
      <span className="operationAction">{locale === "ja" ? "開く" : locale === "zh" ? "打开" : "Open"}</span>
    </>
  );

  if (operation.key === "rooms") {
    return <Link className="operationRow" search={{ subjectId }} to="/exams">{content}</Link>;
  }
  if (operation.key === "results") {
    return <Link className="operationRow" search={{ subjectId }} to="/results">{content}</Link>;
  }
  if (operation.key === "compose") {
    return <Link className="operationRow" search={{ assessmentTypeKey: undefined, subjectId }} to="/exams/new">{content}</Link>;
  }
  const unhandledOperationKey: never = operation.key;
  return unhandledOperationKey;
}

export function OperationsTable({ locale, subject }: { locale: AdminLocale; subject: WorkspaceSubject }) {
  const available = operations.filter((operation) => subject.permissions.includes(operation.permission));
  return (
    <section aria-labelledby="operationsTitle" className="operationsSection">
      <div className="sectionHeading">
        <h2 id="operationsTitle">{locale === "ja" ? "試験管理" : locale === "zh" ? "考试管理" : "Exam management"}</h2>
      </div>
      <div className="operationsTable">
        {available.map((operation) => (
          <OperationLink key={operation.key} locale={locale} operation={operation} subjectId={subject.id} />
        ))}
      </div>
    </section>
  );
}
