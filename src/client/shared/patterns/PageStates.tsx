import type { ReactNode } from "react";

import { Button } from "../ui/Button.tsx";
import { Skeleton } from "../ui/Skeleton.tsx";

export function PageSkeleton({ rows = 4, label = "Loading" }: { rows?: number; label?: string }) {
  return (
    <div aria-label={label} aria-live="polite" className="pageSkeleton" role="status">
      <Skeleton className="skeletonTitle" />
      {Array.from({ length: rows }, (_, index) => <Skeleton className="skeletonRow" key={index} />)}
    </div>
  );
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <section className="emptyState">
      <h2>{title}</h2>
      <p>{description}</p>
      {action ? <div className="stateAction">{action}</div> : null}
    </section>
  );
}

export function QueryErrorState({ title, description, retryLabel, onRetry }: {
  title: string;
  description: string;
  retryLabel: string;
  onRetry: () => void;
}) {
  return (
    <section className="errorState" role="alert">
      <h2>{title}</h2>
      <p>{description}</p>
      <Button onClick={onRetry} variant="secondary">{retryLabel}</Button>
    </section>
  );
}

export function InlineFeedback({ children, tone }: { children: ReactNode; tone: "error" | "success" | "info" }) {
  return <p aria-live={tone === "error" ? "assertive" : "polite"} className="inlineFeedback" data-tone={tone} role={tone === "error" ? "alert" : "status"}>{children}</p>;
}
