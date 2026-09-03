import type { ExamEventContract } from "../../../../types/contracts/exam-events.ts";
import type { AdminLocale } from "../../../shared/i18n/AdminLocaleProvider.tsx";
import { Badge, type BadgeTone } from "../../../shared/ui/Badge.tsx";

const statusPresentation: Record<ExamEventContract["state"], { tone: BadgeTone; ja: string; zh: string; en: string }> = {
  draft: { tone: "neutral", ja: "下書き", zh: "草稿", en: "Draft" }, published: { tone: "info", ja: "公開済み", zh: "已发布", en: "Published" },
  active: { tone: "success", ja: "実施中", zh: "进行中", en: "Active" }, closed: { tone: "neutral", ja: "終了", zh: "已结束", en: "Closed" }, archived: { tone: "neutral", ja: "保管済み", zh: "已归档", en: "Archived" },
};

function formatDate(value: string | null, locale: AdminLocale): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : locale === "en" ? "en-GB" : "ja-JP", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function RecentSystemExams({ exams, locale, subjectNames }: {
  exams: readonly ExamEventContract[];
  locale: AdminLocale;
  subjectNames: ReadonlyMap<string, string>;
}) {
  const labels = locale === "ja"
    ? { roster: "名簿", submitted: "提出" }
    : locale === "zh" ? { roster: "名册", submitted: "提交" } : { roster: "Roster", submitted: "Submitted" };
  return (
    <ul className="systemRecentList">
      {exams.map((exam) => {
        const status = statusPresentation[exam.state];
        return (
          <li className="systemRecentRow" key={exam.code}>
            <div className="systemRecentIdentity">
              <h3>{exam.titleJa}</h3>
              <span><code>{exam.code}</code> · {subjectNames.get(exam.subjectId) ?? "—"}</span>
            </div>
            <span className="systemRecentStatus"><Badge tone={status.tone}>{status[locale]}</Badge></span>
            <span className="systemRecentCounts">{labels.roster} {exam.rosterCount} · {labels.submitted} {exam.submittedCount}</span>
            <time className="systemRecentTime" dateTime={exam.createdAt ?? undefined}>{formatDate(exam.createdAt, locale)}</time>
          </li>
        );
      })}
    </ul>
  );
}
