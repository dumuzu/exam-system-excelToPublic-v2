import type { ButtonProps } from "../ui/Button.tsx";
import { Button } from "../ui/Button.tsx";

interface AsyncButtonProps extends ButtonProps {
  pending: boolean;
  pendingLabel: string;
}

export function AsyncButton({ children, disabled, pending, pendingLabel, ...props }: AsyncButtonProps) {
  return (
    <Button aria-busy={pending} disabled={disabled || pending} {...props}>
      {pending ? pendingLabel : children}
    </Button>
  );
}
