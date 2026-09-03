import type { AdminLocale } from "../../../shared/i18n/AdminLocaleProvider.tsx";
import { Badge, type BadgeTone } from "../../../shared/ui/Badge.tsx";
import type { ResultSummary } from "../types.ts";

const presentation: Record<string, { tone: BadgeTone; ja: string; zh: string; en: string }> = {
  graded: { tone: "success", ja: "採点済み", zh: "已评分", en: "Graded" },
  review_required: { tone: "warning", ja: "確認待ち", zh: "待校对", en: "Review required" },
  pending: { tone: "neutral", ja: "未提出", zh: "未提交", en: "Not submitted" },
  failed: { tone: "danger", ja: "採点失敗", zh: "评分失败", en: "Grading failed" },
};

export function resultStatus(result: ResultSummary): "graded" | "review_required" | "pending" | "failed" {
  if (result.gradingStatus === "failed") return "failed";
  if (result.gradingStatus === "review_required") return "review_required";
  if (result.gradingStatus === "graded" || result.highestScore !== null) return "graded";
  return "pending";
}

export function ResultStatusBadge({ locale, result }: { locale: AdminLocale; result: ResultSummary }) {
  const item = presentation[resultStatus(result)]!;
  return <Badge tone={item.tone}>{item[locale]}</Badge>;
}
