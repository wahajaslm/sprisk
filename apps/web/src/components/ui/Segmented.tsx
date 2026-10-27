import React from "react";

import { ink, P } from "../../styles/palette.ts";

export interface SegmentedProps<T extends string = string> {
  options: { value: T; label: React.ReactNode }[];
  value: T;
  onChange?: (v: T) => void;
}

/** The design's segmented switch, e.g. Pipeline · Operators · Plugins in the sidebar. */
export function Segmented<T extends string = string>({ options, value, onChange }: SegmentedProps<T>) {
  return (
    <div role="tablist" style={{ display: "grid", gridAutoFlow: "column", gridAutoColumns: "minmax(0,1fr)", gap: "2px", padding: "3px", borderRadius: "var(--r-md,8px)", background: "rgba(var(--ink-rgb,255,255,255),0.045)" }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={on}
            className="dx-btn dx-h-text"
            onClick={() => onChange && onChange(o.value)}
            style={{ height: "26px", borderRadius: "var(--r-sm,6px)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "12.5px", fontWeight: "500", cursor: "pointer", whiteSpace: "nowrap", background: on ? ink(0.1) : "transparent", color: on ? P.t0 : P.t3 }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
