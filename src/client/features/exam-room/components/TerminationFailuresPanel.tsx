import { useEffect, useId, useRef, useState } from "react";

import type { RoomTerminationFailure } from "../../../../types/contracts/exam-room.ts";
import type { AdminLocale } from "../../../shared/i18n/AdminLocaleProvider.tsx";
import { Button } from "../../../shared/ui/Button.tsx";
import { examRoomCopy } from "../copy.ts";
import { displayStudentName } from "../model/roomView.ts";

function formatTime(value: string | null, locale: AdminLocale): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "ja-JP", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

export function TerminationFailuresPanel({ canRetry, failures, locale, onRetry, retryingAttemptId }: {
  canRetry: boolean;
  failures: readonly RoomTerminationFailure[];
  locale: AdminLocale;
  onRetry: (failure: RoomTerminationFailure) => void;
  retryingAttemptId: string | null;
}) {
  const titleId = useId();
  const t = examRoomCopy[locale];
  const previousCountRef = useRef(failures.length);
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => {
    if (previousCountRef.current !== failures.length) {
      setAnnouncement(t.failureCount(failures.length));
      previousCountRef.current = failures.length;
    }
  }, [failures.length, t]);

  return (
    <>
      <p aria-atomic="true" aria-live="polite" className="visuallyHidden" role="status">{announcement}</p>
      {failures.length > 0 ? <section aria-labelledby={titleId} className="terminationFailurePanel">
        <header className="terminationFailureHeader">
          <h2 id={titleId}>{t.failureTitle}</h2>
          <p>{t.failureDescription}</p>
        </header>
        <div className="terminationFailureList" role="list">
        {failures.map((failure) => {
          const retrying = retryingAttemptId === failure.attemptId;
          return (
            <article className="terminationFailureRow" key={failure.attemptId} role="listitem">
              <div className="terminationFailureIdentity">
                <strong>{failure.studentNumber}</strong>
                <small lang="und">{displayStudentName(failure.name)} · {t.attemptCount(failure.attemptNumber)}</small>
              </div>
              <div className="terminationFailureDetail">
                <code>{failure.errorCode}</code>
                <span>{failure.errorMessage}</span>
              </div>
              <div className="terminationFailureAudit">
                <span>{t.failureAttempts}: {failure.occurrenceCount}</span>
                <span>{t.failureLastAt}: {formatTime(failure.lastFailedAt, locale)}</span>
              </div>
              {canRetry ? (
                <Button
                  aria-busy={retrying}
                  className="roomActionButton"
                  disabled={retryingAttemptId !== null}
                  onClick={() => onRetry(failure)}
                  variant="danger"
                >
                  {retrying ? t.retryFailurePending : t.retryFailure}
                </Button>
              ) : null}
            </article>
          );
        })}
        </div>
      </section> : null}
    </>
  );
}
