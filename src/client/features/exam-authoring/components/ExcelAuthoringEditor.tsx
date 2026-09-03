import { memo, useMemo } from "react";

import type { AuthoringFunction, AuthoringModeDefinition } from "../../../../types/contracts/exam-authoring.ts";
import type { AdminLocale } from "../../../shared/i18n/AdminLocaleProvider.tsx";
import { Button } from "../../../shared/ui/Button.tsx";
import { authoringCopy } from "../copy.ts";
import type { ExcelAuthoringDraft, ExcelDifficulty } from "../types.ts";

interface ExcelAuthoringEditorProps {
  draft: ExcelAuthoringDraft;
  functions: readonly AuthoringFunction[];
  locale: AdminLocale;
  modes: readonly AuthoringModeDefinition[];
  onDifficultyChange: (difficulty: ExcelDifficulty) => void;
  onFunctionToggle: (functionName: string) => void;
  onModeChange: (mode: "exam" | "assignment") => void;
  onQuestionsPerFunctionChange: (count: number) => void;
  onSelectFunctions: (functionNames: readonly string[]) => void;
}

const categoryLabels: Record<string, Record<AdminLocale, string>> = {
  aggregate: { ja: "集計", zh: "汇总", en: "Aggregation" },
  logic: { ja: "論理", zh: "逻辑", en: "Logic" },
  conditional: { ja: "条件集計", zh: "条件汇总", en: "Conditional aggregation" },
  lookup: { ja: "検索", zh: "查找", en: "Lookup" },
  text: { ja: "文字列", zh: "文本", en: "Text" },
  calculation: { ja: "計算", zh: "计算", en: "Calculation" },
  date: { ja: "日付", zh: "日期", en: "Date" },
  dynamic: { ja: "動的配列", zh: "动态数组", en: "Dynamic arrays" },
};

export const ExcelAuthoringEditor = memo(function ExcelAuthoringEditor({
  draft,
  functions,
  locale,
  modes,
  onDifficultyChange,
  onFunctionToggle,
  onModeChange,
  onQuestionsPerFunctionChange,
  onSelectFunctions,
}: ExcelAuthoringEditorProps) {
  const t = authoringCopy[locale];
  const selected = new Set(draft.selectedFunctions);
  const groupedFunctions = useMemo(() => {
    const groups = new Map<string, AuthoringFunction[]>();
    for (const definition of functions) {
      const group = groups.get(definition.category) ?? [];
      group.push(definition);
      groups.set(definition.category, group);
    }
    return [...groups.entries()];
  }, [functions]);
  const examMode = modes.find((mode) => mode.key === "exam" && !("authoringKind" in mode));
  const assignmentMode = modes.find((mode) => mode.key === "assignment");
  const difficulties = examMode && "difficulties" in examMode
    ? examMode.difficulties.map((difficulty) => difficulty.key)
    : (["easy", "normal", "hard", "hell"] satisfies ExcelDifficulty[]);
  const questionOptions = assignmentMode && "questionsPerFunctionOptions" in assignmentMode
    ? assignmentMode.questionsPerFunctionOptions
    : [5, 10, 15];
  const allSelected = functions.length > 0 && draft.selectedFunctions.length === functions.length;

  return (
    <>
      <fieldset className="authoringFieldset">
        <legend>{t.mode}</legend>
        <div className="authoringModeGrid">
          <label className="authoringModeOption">
            <input checked={draft.mode === "exam"} name="authoringMode" onChange={() => onModeChange("exam")} type="radio" />
            <span><strong>{t.exam}</strong><small>{t.examDescription}</small></span>
          </label>
          <label className="authoringModeOption">
            <input checked={draft.mode === "assignment"} name="authoringMode" onChange={() => onModeChange("assignment")} type="radio" />
            <span><strong>{t.assignment}</strong><small>{t.assignmentDescription}</small></span>
          </label>
        </div>
      </fieldset>

      {draft.mode === "exam" ? (
        <fieldset className="authoringFieldset">
          <legend>{t.difficulty}</legend>
          <div className="authoringSegmented" role="group">
            {difficulties.map((difficulty) => (
              <label key={difficulty}>
                <input
                  checked={draft.difficulty === difficulty}
                  name="authoringDifficulty"
                  onChange={() => onDifficultyChange(difficulty)}
                  type="radio"
                />
                <span>{t.difficultyLabels[difficulty]}</span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : (
        <fieldset className="authoringFieldset">
          <legend>{t.questionsPerFunction}</legend>
          <div className="authoringSegmented" role="group">
            {questionOptions.map((count) => (
              <label key={count}>
                <input
                  checked={draft.questionsPerFunction === count}
                  name="questionsPerFunction"
                  onChange={() => onQuestionsPerFunctionChange(count)}
                  type="radio"
                />
                <span>{count}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <section aria-labelledby="functionCatalogTitle" className="functionCatalogSection">
        <header className="authoringSectionHeader">
          <div><h3 id="functionCatalogTitle">{t.functions}</h3><span>{t.selectedFunctions(draft.selectedFunctions.length)}</span></div>
          <Button
            onClick={() => onSelectFunctions(allSelected ? [] : functions.map((definition) => definition.name))}
            variant="quiet"
          >
            {allSelected ? t.clearAll : t.selectAll}
          </Button>
        </header>
        <div className="functionCatalogGroups">
          {groupedFunctions.map(([category, definitions]) => (
            <fieldset className="functionCatalogGroup" key={category}>
              <legend>{categoryLabels[category]?.[locale] ?? category}</legend>
              <div>
                {definitions.map((definition) => (
                  <label className="functionCatalogOption" key={definition.name}>
                    <input
                      checked={selected.has(definition.name)}
                      onChange={() => onFunctionToggle(definition.name)}
                      type="checkbox"
                    />
                    <code>{definition.name}</code>
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
        </div>
      </section>
    </>
  );
});
