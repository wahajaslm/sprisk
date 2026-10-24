import type { ReactNode } from "react";

export interface PageHeaderProps {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}

/** The header every page shares: what it is, what it is for, and its actions. Stats go in the InfoDock. */
export function PageHeader({ eyebrow, title, description, actions }: PageHeaderProps) {
  return (
    <header className="page-header">
      <div className="page-header-text">
        {eyebrow && <span className="page-header-eyebrow">{eyebrow}</span>}
        <h1 className="page-header-title">{title}</h1>
        {description && <p className="page-header-desc">{description}</p>}
      </div>
      {actions && <div className="page-header-actions">{actions}</div>}
    </header>
  );
}
