import type { ReactNode } from "react";

import { P } from "../../styles/palette.ts";

export interface InfoDockProps {
  rows: { k: string; v: ReactNode; warn?: boolean }[];
}

/** The facts at the foot of a sidebar about what is picked, titled "Info" on every page, copied
 * from the design's main screen. */
export function InfoDock({ rows }: InfoDockProps) {
  return (
    <section aria-label="Info" style={{ borderTop: "1px solid rgba(var(--ink-rgb,255,255,255),0.1)", padding: "10px 14px 12px", display: "flex", flexDirection: "column", gap: "0" }}>
      <h3 style={{ margin: "0", fontSize: "13px", fontWeight: "500", paddingBottom: "4px" }}>Info</h3>
      {rows.map((r) => (
        <div key={r.k} style={{ display: "flex", justifyContent: "space-between", gap: "12px", padding: "4px 0", fontSize: "12.5px" }}>
          <span style={{ color: "var(--t-label,#959595)" }}>{r.k}</span>
          <span style={{ fontVariantNumeric: "tabular-nums", color: r.warn ? P.redHex : P.t0, textAlign: "right", minWidth: "0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.v}</span>
        </div>
      ))}
    </section>
  );
}
