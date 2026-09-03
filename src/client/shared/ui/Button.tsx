import type { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonVariant = "primary" | "secondary" | "quiet" | "danger";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  variant?: ButtonVariant;
}

export function Button({ children, className = "", variant = "secondary", type = "button", ...props }: ButtonProps) {
  return (
    <button
      className={`uiButton uiButton${variant[0]!.toUpperCase()}${variant.slice(1)} ${className}`.trim()}
      type={type}
      {...props}
    >
      {children}
    </button>
  );
}
