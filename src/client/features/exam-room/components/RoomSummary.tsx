import type { AdminLocale } from "../../../shared/i18n/AdminLocaleProvider.tsx";
import { examRoomCopy } from "../copy.ts";
import type { RoomSummaryKey, RoomSummaryMetric } from "../types.ts";

type SummaryTone = "danger" | "info" | "neutral" | "success" | "warning";

function summaryTone(key: RoomSummaryKey): SummaryTone {
  if (["in_progress", "submitted", "assignment_in_progress", "assignment_completed_twice"].includes(key)) {
    return "success";
  }
  if (["waiting_approval", "policy_suspended", "assignment_second_ready", "assignment_submitted_once"].includes(key)) {
    return "warning";
  }
  if (["disconnected", "expired", "policy_submitted"].includes(key)) return "danger";
  if (["admitted", "resume_ready", "teacher_submitted"].includes(key)) return "info";
  return "neutral";
}

export function RoomSummary({ locale, metrics }: {
  locale: AdminLocale;
  metrics: readonly RoomSummaryMetric[];
}) {
  const t = examRoomCopy[locale];
  return (
    <section aria-label={t.status} className="roomSummaryGrid">
      {metrics.map((metric) => (
        <div className="roomSummaryItem" data-tone={summaryTone(metric.key)} key={metric.key}>
          <strong>{metric.count}</strong>
          <span>{t.summaryLabels[metric.key]}</span>
        </div>
      ))}
    </section>
  );
}
