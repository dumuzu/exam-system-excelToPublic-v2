import { useEffect, useId, useRef } from "react";

import type { RoomTerminationFailure } from "../../../../types/contracts/exam-room.ts";
import type { AdminLocale } from "../../../shared/i18n/AdminLocaleProvider.tsx";
import { AsyncButton } from "../../../shared/patterns/AsyncButton.tsx";
import { Button } from "../../../shared/ui/Button.tsx";
import { examRoomCopy } from "../copy.ts";
import { displayStudentName } from "../model/roomView.ts";

export function RoomFailureRetryDialog({ failure, locale, onCancel, onConfirm, pending }: {
  failure: RoomTerminationFailure | null;
  locale: AdminLocale;
  onCancel: () => void;
  onConfirm: (failure: RoomTerminationFailure) => void;
  pending: boolean;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const t = examRoomCopy[locale];

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (failure && !dialog.open) dialog.showModal();
    if (!failure && dialog.open) dialog.close();
  }, [failure]);

  return (
    <dialog
      aria-describedby={descriptionId}
      aria-labelledby={titleId}
      className="confirmDialog"
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) onCancel();
      }}
      ref={dialogRef}
    >
      {failure ? (
        <>
          <div className="confirmDialogBody">
            <h2 id={titleId}>{t.retryFailureTitle}</h2>
            <p id={descriptionId}>{t.retryFailureDescription}</p>
            <p className="roomActionDialogObject">
              {failure.studentNumber} · {displayStudentName(failure.name)} · {failure.errorCode}
            </p>
          </div>
          <div className="confirmDialogActions">
            <Button disabled={pending} onClick={onCancel} variant="secondary">{t.cancel}</Button>
            <AsyncButton onClick={() => onConfirm(failure)} pending={pending} pendingLabel={t.retryFailurePending} variant="primary">
              {t.retryFailure}
            </AsyncButton>
          </div>
        </>
      ) : null}
    </dialog>
  );
}
