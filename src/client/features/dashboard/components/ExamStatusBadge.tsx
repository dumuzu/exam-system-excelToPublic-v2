import { Badge, type BadgeTone } from "../../../shared/ui/Badge.tsx";
import type { AdminLocale } from "../../../shared/i18n/AdminLocaleProvider.tsx";

const statusPresentation: Record<string, { tone: BadgeTone; ja: string; zh: string; en: string }> = {
  active: { tone: "success", ja: "実施中", zh: "进行中", en: "Active" },
  waiting: { tone: "info", ja: "待機", zh: "等待", en: "Waiting" },
  preparing: { tone: "warning", ja: "準備中", zh: "准备中", en: "Preparing" },
  draft: { tone: "warning", ja: "準備中", zh: "准备中", en: "Preparing" },
  published: { tone: "warning", ja: "準備中", zh: "准备中", en: "Preparing" },
  closed: { tone: "neutral", ja: "終了", zh: "已结束", en: "Closed" },
  archived: { tone: "neutral", ja: "終了", zh: "已结束", en: "Closed" },
  terminated: { tone: "danger", ja: "中止済み", zh: "已中止", en: "Terminated" },
  aborted: { tone: "danger", ja: "中止", zh: "已中止", en: "Terminated" },
};

export function ExamStatusBadge({ status, locale }: { status: string; locale: AdminLocale }) {
  const presentation = statusPresentation[status] ?? { tone: "neutral" as const, ja: status, zh: status, en: status };
  return <Badge tone={presentation.tone}>{presentation[locale]}</Badge>;
}
