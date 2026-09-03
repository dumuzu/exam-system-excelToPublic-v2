import type { AdminLocale } from "../../../shared/i18n/AdminLocaleProvider.tsx";
import { EmptyState } from "../../../shared/patterns/PageStates.tsx";
import { Badge } from "../../../shared/ui/Badge.tsx";
import type { ResultAuditEntry, ResultSummary } from "../types.ts";

const labels = {
  ja: { title: "警告・停止・回収ログ", empty: "監督ログはありません", emptyDescription: "警告、一時停止、強制提出の記録はありません。", warning: "警告", suspended: "答題停止", resumed: "再開", collected: "教師回収", forced: "強制提出", teacher: "教師一括回収", policy: "規則による提出", attempt: "受験" },
  zh: { title: "警告、暂停与收卷日志", empty: "没有监考日志", emptyDescription: "没有警告、暂停或强制提交记录。", warning: "警告", suspended: "答题暂停", resumed: "恢复", collected: "教师收卷", forced: "强制提交", teacher: "教师统一收卷", policy: "规则强制提交", attempt: "考试" },
  en: { title: "Warnings, suspensions, and collections", empty: "No proctoring events", emptyDescription: "There are no warnings, suspensions, or forced submissions.", warning: "Warning", suspended: "Suspended", resumed: "Resumed", collected: "Collected by teacher", forced: "Forced submission", teacher: "Teacher collection", policy: "Policy submission", attempt: "Attempt" },
} as const;

function auditEntries(results: readonly ResultSummary[]): ResultAuditEntry[] {
  return results.flatMap((result) => [
    ...result.warningEvents.map((event, index) => ({
      key: `${result.studentNumber}-warning-${event.occurredAt}-${index}`,
      student: result,
      attemptNumber: event.attemptNumber ?? 1,
      type: "warning" as const,
      detail: event.eventType ?? "warning",
      occurredAt: event.occurredAt,
    })),
    ...result.policySuspensions.map((event, index) => ({
      key: `${result.studentNumber}-suspended-${event.suspendedAt}-${index}`,
      student: result,
      attemptNumber: event.attemptNumber ?? 1,
      type: "suspended" as const,
      detail: event.status === "collected" ? "collected" : event.resumedAt ? "resumed" : "suspended",
      occurredAt: event.suspendedAt,
      ...(event.resumedAt || event.collectedAt ? { secondaryAt: event.resumedAt ?? event.collectedAt } : {}),
      ...(event.resumedBy || event.collectedBy ? { actor: event.resumedBy ?? event.collectedBy } : {}),
      ...(event.remainingSeconds === undefined ? {} : { remainingSeconds: event.remainingSeconds }),
    })),
    ...result.forcedSubmissionEvents.map((event, index) => ({
      key: `${result.studentNumber}-forced-${event.submittedAt}-${index}`,
      student: result,
      attemptNumber: event.attemptNumber ?? 1,
      type: "forced" as const,
      detail: event.submissionType ?? "policy",
      occurredAt: event.submittedAt,
    })),
  ]).sort((left, right) => new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime());
}

function formatDate(value: string, locale: AdminLocale): string {
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : locale === "en" ? "en-GB" : "ja-JP", { dateStyle: "medium", timeStyle: "medium" }).format(new Date(value));
}

export function AuditLog({ locale, results }: { locale: AdminLocale; results: readonly ResultSummary[] }) {
  const t = labels[locale];
  const entries = auditEntries(results);
  if (entries.length === 0) return <EmptyState description={t.emptyDescription} title={t.empty} />;

  return (
    <section aria-label={t.title} className="auditLogPanel">
      <header><h2>{t.title}</h2><span>{entries.length}</span></header>
      <div className="auditLogList">
        {entries.map((entry) => {
          const eventLabel = entry.type === "warning" ? t.warning : entry.type === "suspended" ? t.suspended : entry.detail === "teacher" ? t.teacher : t.policy;
          const tone = entry.type === "warning" ? "warning" : entry.type === "suspended" ? "danger" : "info";
          return (
            <article className="auditLogRow" key={entry.key}>
              <span className="studentIdentity"><strong>{entry.student.name}</strong><code>{entry.student.studentNumber}</code></span>
              <span className="auditEvent"><Badge tone={tone}>{eventLabel}</Badge><small>{t.attempt} #{entry.attemptNumber} · {entry.detail}</small></span>
              <span className="auditTiming"><time dateTime={entry.occurredAt}>{formatDate(entry.occurredAt, locale)}</time>{entry.secondaryAt ? <small>{entry.detail === "collected" ? t.collected : t.resumed}: {formatDate(entry.secondaryAt, locale)}{entry.actor ? ` · ${entry.actor}` : ""}</small> : null}</span>
            </article>
          );
        })}
      </div>
    </section>
  );
}
