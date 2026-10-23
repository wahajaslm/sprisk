import React from "react";

export interface SegmentedProps<T extends string = string> {
  options: { value: T; label: React.ReactNode }[];
  value: T;
  onChange?: (v: T) => void;
}

export function Segmented<T extends string = string>({ options, value, onChange }: SegmentedProps<T>) {
  return (
    <div
      style={{
        display: "inline-flex",
        gap: 2,
        padding: 3,
        borderRadius: "var(--radius-md)",
        background: "var(--bg-subtle)",
      }}
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <div
            key={o.value}
            onClick={() => onChange && onChange(o.value)}
            style={{
              height: 24,
              padding: "0 10px",
              borderRadius: "var(--radius-sm)",
              display: "flex",
              alignItems: "center",
              cursor: "pointer",
              fontSize: "var(--fs-13)",
              fontWeight: "var(--fw-medium)",
              whiteSpace: "nowrap",
              background: on ? "var(--alpha-09)" : "transparent",
              color: on ? "var(--text-primary)" : "var(--ink-4)",
            }}
          >
            {o.label}
          </div>
        );
      })}
    </div>
  );
}
