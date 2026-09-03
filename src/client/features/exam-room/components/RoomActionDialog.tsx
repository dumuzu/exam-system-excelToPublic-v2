import { useEffect, useId, useRef } from "react";

import type { AdminLocale } from "../../../shared/i18n/AdminLocaleProvider.tsx";
import { AsyncButton } from "../../../shared/patterns/AsyncButton.tsx";
import { Button } from "../../../shared/ui/Button.tsx";
import { examRoomCopy } from "../copy.ts";
import { displayStudentName } from "../model/roomView.ts";
import type { RoomStudentActionTarget } from "../types.ts";

export function RoomActionDialog({ locale, onCancel, onConfirm, pending, target }: {
  locale: AdminLocale;
  onCancel: () => void;
  onConfirm: (target: RoomStudentActionTarget) => void;
  pending: boolean;
  target: RoomStudentActionTarget | null;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const t = examRoomCopy[locale];

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (target && !dialog.open) dialog.showModal();
    if (!target && dialog.open) dialog.close();
  }, [target]);

  const isRetake = target?.action === "retake";
  const title = isRetake ? t.retakeTitle : t.resumeTitle;
  const description = isRetake
    ? t.retakeDescription
    : target?.student.status === "policy_suspended"
      ? t.suspendedResumeDescription
      : t.resumeDescription;
  const confirmLabel = isRetake ? t.retakeConfirm : t.resumeConfirm;
  const pendingLabel = isRetake ? t.retakePending : t.resumePending;

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
      {target ? (
        <>
          <div className="confirmDialogBody">
            <h2 id={titleId}>{title}</h2>
            <p id={descriptionId}>{description}</p>
            <p className="roomActionDialogObject">
              {target.student.studentNumber} · {displayStudentName(target.student.name)}
            </p>
          </div>
          <div className="confirmDialogActions">
            <Button disabled={pending} onClick={onCancel} variant="secondary">{t.cancel}</Button>
            <AsyncButton
              onClick={() => onConfirm(target)}
              pending={pending}
              pendingLabel={pendingLabel}
              variant={isRetake ? "danger" : "primary"}
            >
              {confirmLabel}
            </AsyncButton>
          </div>
        </>
      ) : null}
    </dialog>
  );
}
