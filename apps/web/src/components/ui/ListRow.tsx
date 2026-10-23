export interface ListRowProps {
  title: string;
  meta?: string;
  /** A short state word on the right, e.g. "Issue" or "Running". */
  badge?: string;
  /** A problem: the title and badge turn red (ADR-0061). */
  warn?: boolean;
  selected?: boolean;
  onClick: () => void;
}

/** One sidebar row, as the design draws it: a title, an optional line of facts, a badge. */
export function ListRow({ title, meta, badge, warn = false, selected = false, onClick }: ListRowProps) {
  return (
    <button
      type="button"
      className={`side-row${meta ? " two" : ""}${warn ? " warn" : ""}`}
      aria-current={selected ? "true" : undefined}
      onClick={onClick}
    >
      <span className="side-row-text">
        <span className="side-row-title">{title}</span>
        {meta && <span className="side-row-meta">{meta}</span>}
      </span>
      {badge && <span className="side-row-badge">{badge}</span>}
    </button>
  );
}
