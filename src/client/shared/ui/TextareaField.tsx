import type { Ref, TextareaHTMLAttributes } from "react";

export interface TextareaFieldProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "id"> {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  textareaRef?: Ref<HTMLTextAreaElement>;
}

export function TextareaField({ id, label, hint, error, textareaRef, className = "", ...props }: TextareaFieldProps) {
  const descriptionId = hint || error ? `${id}Description` : undefined;
  return (
    <label className={`fieldGroup ${className}`.trim()} htmlFor={id}>
      <span className="fieldLabel">{label}</span>
      <textarea
        aria-describedby={descriptionId}
        aria-invalid={Boolean(error)}
        className="textareaField"
        id={id}
        ref={textareaRef}
        {...props}
      />
      {hint || error ? (
        <span className={error ? "fieldMessage fieldMessageError" : "fieldMessage"} id={descriptionId}>
          {error ?? hint}
        </span>
      ) : null}
    </label>
  );
}
