import { type ReactNode, useState } from "react";

export interface SideGroupProps {
  /** Its position in the sidebar, 1-based; shown as "01". */
  num: number;
  label: string;
  /** A count or progress on the right, e.g. "3" or "2 / 3". */
  meta?: ReactNode;
  children: ReactNode;
}

/** A group of sidebar rows under a numbered label that folds them away, as the design draws it. */
export function SideGroup({ num, label, meta, children }: SideGroupProps) {
  const [open, setOpen] = useState(true);
  return (
    <div className="side-group">
      <button type="button" className="side-label" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="side-label-num">{String(num).padStart(2, "0")}</span>
        <span className="side-label-name">{label}</span>
        {meta != null && <span className="side-label-meta">{meta}</span>}
        <svg className="side-label-chevron" width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M2.5 3.75L5 6.25l2.5-2.5" />
        </svg>
      </button>
      {open && <div className="side-group-rows">{children}</div>}
    </div>
  );
}
