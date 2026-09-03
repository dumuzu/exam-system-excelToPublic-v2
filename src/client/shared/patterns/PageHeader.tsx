import type { ReactNode } from "react";

export function PageHeader({ title, description, actions }: {
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <header className="pageHeader">
      <div>
        <h1>{title}</h1>
        <p className="pageDescription">{description}</p>
      </div>
      {actions ? <div className="pageActions">{actions}</div> : null}
    </header>
  );
}
