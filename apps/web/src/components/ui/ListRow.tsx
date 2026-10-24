import type { ReactNode } from "react";

export interface ListRowProps {
  title: string;
  meta?: string;
  /** A short state word on the right, e.g. "Issue" or "Running". */
  badge?: string;
  /** A problem: the title and badge turn red (ADR-0061). */
  warn?: boolean;
  selected?: boolean;
  /** A 24px icon disc on the left, e.g. a step's kind. */
  icon?: ReactNode;
  /** Shown on hover, e.g. a long description that would not fit. */
  hint?: string;
  /** Absent: the row is a plain item, not a button. */
  onClick?: () => void;
}

/** One sidebar row, as the design draws it: a title, an optional line of facts, a badge. */
export function ListRow({ title, meta, badge, warn = false, selected = false, icon, hint, onClick }: ListRowProps) {
  const className = `side-row${meta ? " two" : ""}${warn ? " warn" : ""}`;
  const content = (
    <>
      {icon && <span className="side-row-icon">{icon}</span>}
      <span className="side-row-text">
        <span className="side-row-title">{title}</span>
        {meta && <span className="side-row-meta">{meta}</span>}
      </span>
      {badge && <span className="side-row-badge">{badge}</span>}
    </>
  );
  if (!onClick) {
    return (
      <div className={`${className} static`} title={hint}>
        {content}
      </div>
    );
  }
  return (
    <button type="button" className={className} aria-current={selected ? "true" : undefined} title={hint} onClick={onClick}>
      {content}
    </button>
  );
}
