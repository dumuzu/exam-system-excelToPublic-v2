import type { AdminLocale } from "../../../shared/i18n/AdminLocaleProvider.tsx";
import type { ResultSummary } from "../types.ts";

const labels = {
  ja: { students: "対象学生", graded: "採点済み", average: "最高得点の平均", distribution: "最高得点の分布" },
  zh: { students: "学生人数", graded: "已评分", average: "平均最高分", distribution: "最高成绩分布" },
  en: { students: "Students", graded: "Graded", average: "Average highest score", distribution: "Highest-score distribution" },
} as const;

function scorePercentage(result: ResultSummary): number | null {
  if (result.highestScore === null || result.highestMaximumScore === null || result.highestMaximumScore <= 0) return null;
  return result.highestScore / result.highestMaximumScore * 100;
}

export function ResultOverview({ locale, results }: { locale: AdminLocale; results: readonly ResultSummary[] }) {
  const t = labels[locale];
  const graded = results.filter((result) => result.highestScore !== null && result.highestMaximumScore !== null);
  const average = graded.length > 0
    ? Math.round(graded.reduce((sum, result) => sum + Number(result.highestScore), 0) / graded.length * 100) / 100
    : null;
  const buckets = [0, 20, 40, 60, 80] as const;

  return (
    <>
      <section aria-label={locale === "ja" ? "成績概要" : locale === "zh" ? "成绩概览" : "Results overview"} className="resultMetricBand">
        {[[t.students, results.length], [t.graded, graded.length], [t.average, average ?? "—"]].map(([label, value]) => (
          <div key={label}><span>{label}</span><strong>{value}</strong></div>
        ))}
      </section>
      <section className="scoreDistribution">
        <header><h2>{t.distribution}</h2><span>{graded.length}</span></header>
        <div>
          {buckets.map((start) => {
            const end = start === 80 ? 100 : start + 19;
            const count = graded.filter((result) => {
              const percentage = scorePercentage(result);
              return percentage !== null && percentage >= start && (start === 80 ? percentage <= 100 : percentage < start + 20);
            }).length;
            const percentage = graded.length > 0 ? Math.round(count / graded.length * 100) : 0;
            return (
              <div className="scoreDistributionRow" key={start}>
                <span>{start}–{end}%</span>
                <progress aria-label={`${start}–${end}%`} max={100} value={percentage}>{percentage}%</progress>
                <strong>{count}</strong>
              </div>
            );
          })}
        </div>
      </section>
    </>
  );
}
