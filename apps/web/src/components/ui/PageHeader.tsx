import type { ReactNode } from "react";

export type PageHeaderProps = {
  eyebrow?: ReactNode;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
};

/** Flow Studio PageHeader: eyebrow, 30px title, description, actions, bottom hairline. */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className = "",
}: PageHeaderProps) {
  return (
    <header className={`page-head ${className}`.trim()}>
      <div className="page-head-main">
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1 className="page-title">{title}</h1>
        {description && <div className="page-desc">{description}</div>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}
