import { useEffect, useId, useRef, type ReactNode } from "react";

import { AsyncButton } from "./AsyncButton.tsx";
import { Button } from "../ui/Button.tsx";
import type { ButtonProps } from "../ui/Button.tsx";

export function DestructiveConfirmDialog({
  cancelLabel,
  children,
  confirmLabel,
  confirmDisabled = false,
  confirmVariant = "danger",
  description,
  objectLabel,
  onCancel,
  onConfirm,
  open,
  pending,
  pendingLabel,
  progress,
  title,
}: {
  cancelLabel: string;
  children?: ReactNode;
  confirmLabel: string;
  confirmDisabled?: boolean;
  confirmVariant?: ButtonProps["variant"];
  description: string;
  objectLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
  open: boolean;
  pending: boolean;
  pendingLabel: string;
  progress?: string;
  title: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

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
      <div className="confirmDialogBody">
        <h2 id={titleId}>{title}</h2>
        <p id={descriptionId}>{description}</p>
        <code>{objectLabel}</code>
        {children}
        {progress ? <p aria-live="polite" className="dialogProgress">{progress}</p> : null}
      </div>
      <div className="confirmDialogActions">
        <Button disabled={pending} onClick={onCancel} variant="secondary">{cancelLabel}</Button>
        <AsyncButton disabled={confirmDisabled} onClick={onConfirm} pending={pending} pendingLabel={pendingLabel} variant={confirmVariant}>{confirmLabel}</AsyncButton>
      </div>
    </dialog>
  );
}
