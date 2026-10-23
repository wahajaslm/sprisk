import React from "react";

export interface TabsProps {
  items: { value: string; label: React.ReactNode }[];
  value: string;
  onChange?: (v: string) => void;
}

export function Tabs({ items, value, onChange }: TabsProps) {
  return (
    <div
      style={{
        height: "var(--size-tabbar)",
        display: "flex",
        alignItems: "stretch",
        gap: 20,
        padding: "0 16px",
        borderBottom: "1px solid var(--border-divider)",
      }}
    >
      {items.map((it) => {
        const on = it.value === value;
        return (
          <div
            key={it.value}
            onClick={() => onChange && onChange(it.value)}
            style={{
              display: "flex",
              alignItems: "center",
              fontSize: "var(--fs-13-5)",
              fontWeight: "var(--fw-medium)",
              cursor: "pointer",
              color: on ? "var(--text-primary)" : "var(--ink-5)",
              boxShadow: on ? "inset 0 -1px 0 var(--ink-1)" : "none",
            }}
          >
            {it.label}
          </div>
        );
      })}
    </div>
  );
}
