import { type ReactNode, useState } from "react";

export interface SideGroupProps {
  label: string;
  /** A count or progress on the right, e.g. "3" or "2 / 3". */
  meta?: ReactNode;
  children: ReactNode;
}

/** A group of sidebar rows under a label that folds them away, copied from the design's main
 * screen. Every group after the first starts with a hairline (designx.css). */
export function SideGroup({ label, meta, children }: SideGroupProps) {
  const [open, setOpen] = useState(true);
  return (
    <section className="side-group" aria-label={label} style={{ display: "flex", flexDirection: "column", gap: "1px", paddingBottom: open ? "6px" : "0" }}>
      <button type="button" className="dx-btn dx-h-04" aria-expanded={open} onClick={() => setOpen(!open)} style={{ height: "30px", padding: "0 8px 0 10px", borderRadius: "var(--r-sm,6px)", display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", userSelect: "none" }}>
        <span style={{ flex: "1", fontSize: "12.5px", fontWeight: "500", color: "var(--t-muted,#ababab)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
        {meta != null && <span style={{ fontSize: "12px", color: "var(--t-faint,#8c8c8c)", fontVariantNumeric: "tabular-nums" }}>{meta}</span>}
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ color: "var(--t-faint,#8c8c8c)", transform: open ? "none" : "rotate(-90deg)", transition: "transform .15s", flexShrink: "0" }}>
          <path d="M2.5 3.75L5 6.25l2.5-2.5" />
        </svg>
      </button>
      {open && children}
    </section>
  );
}
