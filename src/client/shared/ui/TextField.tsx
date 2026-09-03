import type { InputHTMLAttributes } from "react";

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "id"> {
  id: string;
  label: string;
  hint?: string;
  error?: string;
}

export function TextField({ id, label, hint, error, className = "", ...props }: TextFieldProps) {
  const descriptionId = `${id}Description`;
  const message = error ?? hint ?? "";
  return (
    <label className={`fieldGroup ${className}`.trim()} htmlFor={id}>
      <span className="fieldLabel">{label}</span>
      <input
        aria-describedby={message ? descriptionId : undefined}
        aria-invalid={Boolean(error)}
        className="textField"
        id={id}
        {...props}
      />
      <span
        aria-hidden={!message}
        className={error ? "fieldMessage fieldMessageError" : "fieldMessage"}
        id={descriptionId}
      >
        {message}
      </span>
    </label>
  );
}
