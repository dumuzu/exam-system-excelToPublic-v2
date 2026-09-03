import { useId } from "react";

import type { AdminLocale } from "../../../shared/i18n/AdminLocaleProvider.tsx";
import { authoringCopy } from "../copy.ts";
import type { RosterImportResult } from "../types.ts";

interface RosterImportFieldProps {
  busy: boolean;
  error: string | null;
  locale: AdminLocale;
  onFilesSelected: (files: readonly File[]) => void;
  result: RosterImportResult | null;
}

export function RosterImportField({ busy, error, locale, onFilesSelected, result }: RosterImportFieldProps) {
  const id = useId();
  const t = authoringCopy[locale];

  return (
    <section aria-labelledby={`${id}Label`} className="rosterImportField">
      <div className="rosterImportHeading">
        <div><strong id={`${id}Label`}>{t.roster}</strong><small>{t.rosterHint}</small></div>
        <label className="rosterFileButton" htmlFor={id}>
          {busy ? t.rosterImporting : result ? t.rosterReplace : t.rosterChoose}
        </label>
        <input
          accept=".csv,.xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
          disabled={busy}
          id={id}
          multiple
          onChange={(event) => {
            const files = Array.from(event.currentTarget.files ?? []);
            if (files.length) onFilesSelected(files);
            event.currentTarget.value = "";
          }}
          type="file"
        />
      </div>
      {error ? <p className="inlineFeedback" data-tone="error" role="alert">{error}</p> : null}
      {result ? (
        <div aria-live="polite" className="rosterImportResult">
          <div className="rosterImportMetrics">
            <strong>{t.rosterStudents(result.count)}</strong>
            <span>{t.rosterFiles(result.sourceFileCount)}</span>
            {result.duplicateCount > 0 ? <span>{t.rosterDuplicates(result.duplicateCount)}</span> : null}
          </div>
          <div className="rosterPreview" role="table" aria-label={t.roster}>
            <div className="rosterPreviewHeader" role="row">
              <span role="columnheader">{t.rosterStudentNumber}</span>
              <span role="columnheader">{t.rosterName}</span>
            </div>
            {result.previewRows.slice(0, 6).map((student) => (
              <div className="rosterPreviewRow" key={student.studentNumber} role="row">
                <code role="cell">{student.studentNumber}</code>
                <span role="cell">{student.name}</span>
              </div>
            ))}
            {result.count > 6 ? <p>{t.rosterMore(result.count - 6)}</p> : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
