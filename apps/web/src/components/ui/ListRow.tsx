import type { ReactNode } from "react";

import { ink, P } from "../../styles/palette.ts";

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

/** One sidebar row, copied from the design's main screen: an icon disc, a title, an optional line
 * of facts, a badge. */
export function ListRow({ title, meta, badge, warn = false, selected = false, icon, hint, onClick }: ListRowProps) {
  const style = {
    minHeight: meta ? "0" : icon ? "36px" : "34px",
    padding: icon ? (meta ? "6px 8px" : "0 8px") : meta ? "7px 10px" : "0 10px",
    borderRadius: "var(--r-sm,6px)",
    display: "flex",
    alignItems: "center",
    gap: "10px",
    cursor: onClick ? "pointer" : "default",
    background: selected ? ink(0.08) : "transparent",
    minWidth: "0",
    width: "100%",
  } as const;
  const content = (
    <>
      {icon && (
        <span className={selected ? "dx-disc-on" : warn ? "dx-disc-warn" : undefined} style={{ width: "24px", height: "24px", borderRadius: "50%", flexShrink: "0", display: "flex", alignItems: "center", justifyContent: "center", background: selected ? ink(0.14) : warn ? `rgba(${P.red},0.14)` : ink(0.06) }}>
          {icon}
        </span>
      )}
      <span style={{ flex: "1", display: "flex", flexDirection: "column", gap: "1px", minWidth: "0" }}>
        <span style={{ fontSize: "13.5px", color: warn ? P.redHex : selected ? P.t0 : P.t1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</span>
        {meta && <span style={{ fontSize: "12px", color: "var(--t-faint,#8c8c8c)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{meta}</span>}
      </span>
      {badge && (
        <span style={{ fontSize: "11px", fontWeight: "500", padding: "1px 6px", borderRadius: "var(--r-sm,6px)", whiteSpace: "nowrap", flexShrink: "0", color: warn ? P.redHex : P.t1, background: warn ? `rgba(${P.red},0.12)` : ink(0.07) }}>{badge}</span>
      )}
    </>
  );
  if (!onClick) {
    return (
      <div title={hint} style={style}>
        {content}
      </div>
    );
  }
  return (
    <button type="button" className="dx-btn dx-h-05" aria-current={selected ? "true" : undefined} title={hint} onClick={onClick} style={style}>
      {content}
    </button>
  );
}
