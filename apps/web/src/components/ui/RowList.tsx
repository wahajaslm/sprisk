import type { ReactNode } from "react";

/** A titled block of a page body: a 15px title, a short note, then its content (design). */
export function BodySection({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="body-section" aria-label={title}>
      <h2 className="body-section-title">{title}</h2>
      {note && <p className="body-section-note">{note}</p>}
      {children}
    </section>
  );
}

export function RowList({ label, children }: { label: string; children: ReactNode }) {
  return (
    <ul className="row-list" aria-label={label}>
      {children}
    </ul>
  );
}

export interface RowItemProps {
  name: ReactNode;
  meta?: ReactNode;
  /** A problem: the facts turn red (ADR-0061). */
  warn?: boolean;
  /** A button or tag on the right. */
  action?: ReactNode;
  /** Makes the whole row a button that opens or closes `children` below it. */
  onToggle?: () => void;
  open?: boolean;
  children?: ReactNode;
}

/** One row of a body list: a name over its facts, an action on the right. */
export function RowItem({ name, meta, warn = false, action, onToggle, open = false, children }: RowItemProps) {
  const text = (
    <span className="row-list-text">
      <span className="row-list-name">{name}</span>
      {meta != null && <span className={`row-list-meta${warn ? " warn" : ""}`}>{meta}</span>}
    </span>
  );
  return (
    <li>
      {onToggle ? (
        <button type="button" className="row-list-item" aria-expanded={open} onClick={onToggle}>
          {text}
          {action}
        </button>
      ) : (
        <div className="row-list-item">
          {text}
          {action}
        </div>
      )}
      {open && children}
    </li>
  );
}
