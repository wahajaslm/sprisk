import type { ReactNode } from "react";

/** The one header every top-level page uses, so titles sit at the same place and size. */
export function PageHeader({ eyebrow, title, description, actions }: { eyebrow: ReactNode; title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="page-head">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        {description && <p className="muted">{description}</p>}
      </div>
      {actions}
    </header>
  );
}
