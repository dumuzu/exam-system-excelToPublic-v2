import type { AuthoringConfiguration } from "../../../../types/contracts/exam-authoring.ts";
import type { AdminLocale } from "../../../shared/i18n/AdminLocaleProvider.tsx";
import { Button } from "../../../shared/ui/Button.tsx";
import { authoringCopy } from "../copy.ts";

interface ConfigurationHistoryPanelProps {
  configurations: readonly AuthoringConfiguration[];
  error: boolean;
  loading: boolean;
  loadingId: string | null;
  locale: AdminLocale;
  onRefresh: () => void;
  onUse: (configurationId: string) => void;
  refreshing: boolean;
}

export function ConfigurationHistoryPanel({
  configurations,
  error,
  loading,
  loadingId,
  locale,
  onRefresh,
  onUse,
  refreshing,
}: ConfigurationHistoryPanelProps) {
  const t = authoringCopy[locale];
  const formatter = new Intl.DateTimeFormat(locale === "ja" ? "ja-JP" : locale === "zh" ? "zh-CN" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  });
  return (
    <section aria-labelledby="configurationHistoryTitle" className="authoringSidePanel">
      <header className="authoringPanelHeader">
        <h2 id="configurationHistoryTitle">{t.history}</h2>
        <Button disabled={refreshing} onClick={onRefresh} variant="quiet">
          {refreshing ? t.historyRefreshing : t.historyRefresh}
        </Button>
      </header>
      {loading ? <p className="authoringPanelEmpty" aria-live="polite">{t.historyRefreshing}</p> : null}
      {error ? <p className="inlineFeedback" data-tone="error">{t.historyLoadError}</p> : null}
      {!loading && !error && configurations.length === 0 ? <p className="authoringPanelEmpty">{t.historyEmpty}</p> : null}
      {!loading && !error && configurations.length > 0 ? (
        <div className="configurationHistoryList">
          {configurations.map((configuration) => {
            const manualCount = configuration.plan.questions?.length ?? 0;
            return (
              <button
                aria-busy={loadingId === configuration.id}
                className="configurationHistoryItem"
                disabled={loadingId !== null}
                key={configuration.id}
                onClick={() => onUse(configuration.id)}
                type="button"
              >
                <span className="configurationHistoryTitle"><strong>{configuration.name}</strong><small>{configuration.mode === "assignment" ? t.assignment : t.exam}</small></span>
                <span className="configurationHistoryTags">
                  {configuration.assessmentTypeKey === "manual_questions"
                    ? <code>{manualCount} {locale === "ja" ? "問" : locale === "zh" ? "题" : "questions"}</code>
                    : configuration.selectedFunctions.slice(0, 6).map((name) => <code key={name}>{name}</code>)}
                  {configuration.selectedFunctions.length > 6 ? <code>+{configuration.selectedFunctions.length - 6}</code> : null}
                </span>
                <time dateTime={configuration.updatedAt}>{formatter.format(new Date(configuration.updatedAt))}</time>
              </button>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
