import type { AdminLocale } from "../../../shared/i18n/AdminLocaleProvider.tsx";
import { Badge, type BadgeTone } from "../../../shared/ui/Badge.tsx";
import type { ExamEvent } from "../types.ts";

const statusPresentation: Record<string, { tone: BadgeTone; ja: string; zh: string; en: string }> = {
  active: { tone: "success", ja: "実施中", zh: "进行中", en: "Active" },
  preparing: { tone: "warning", ja: "準備中", zh: "准备中", en: "Preparing" },
  closed: { tone: "neutral", ja: "終了", zh: "已结束", en: "Closed" },
  terminated: { tone: "danger", ja: "中止済み", zh: "已中止", en: "Terminated" },
};

function statusKey(exam: ExamEvent): keyof typeof statusPresentation {
  if (exam.terminated) return "terminated";
  if (exam.state === "active") return "active";
  if (exam.state === "closed" || exam.state === "archived") return "closed";
  return "preparing";
}

export function ExamEventStatusBadge({ exam, locale }: { exam: ExamEvent; locale: AdminLocale }) {
  const presentation = statusPresentation[statusKey(exam)]!;
  return <Badge tone={presentation.tone}>{presentation[locale]}</Badge>;
}
