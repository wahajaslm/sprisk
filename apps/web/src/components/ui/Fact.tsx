import type { ReactNode } from "react";

import { P } from "../../styles/palette.ts";

/** One fact row, as the design lists a step's measurements: the name on the left, the value on
 * the right in even-width figures, a faint hairline below. */
export function Fact({ k, v, warn = false }: { k: string; v: ReactNode; warn?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", padding: "6px 0", borderBottom: "1px solid rgba(var(--ink-rgb,255,255,255),0.05)", fontSize: "13px" }}>
      <span style={{ color: "var(--t-label,#959595)" }}>{k}</span>
      <span className="dx-fact" style={{ fontVariantNumeric: "tabular-nums", textAlign: "right", color: warn ? P.red : P.t0, minWidth: "0" }}>{v}</span>
    </div>
  );
}
