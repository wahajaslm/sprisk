import React from "react";

export interface StageCardProps {
  label: string;
  description?: string;
  progress?: string;
  active?: boolean;
  children?: React.ReactNode;
  width?: number | string;
}

export function StageCard({
  label,
  description,
  progress,
  active = false,
  children,
  width = 266,
}: StageCardProps) {
  return (
    <div
      style={{
        width,
        borderRadius: "var(--radius-md)",
        border: "1px solid " + (active ? "var(--border-card-active)" : "var(--border-card)"),
        background: active ? "var(--bg-card-active)" : "var(--bg-card)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div style={{ padding: "18px 18px 0", display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
          <span
            style={{
              fontSize: "var(--fs-17)",
              fontWeight: "var(--fw-medium)",
              letterSpacing: "-0.01em",
            }}
          >
            {label}
          </span>
          {progress && (
            <span
              style={{
                fontSize: "var(--fs-12)",
                color: "var(--ink-6)",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {progress}
            </span>
          )}
        </div>
        {description && (
          <span
            style={{
              fontSize: "var(--fs-12)",
              lineHeight: "var(--lh-body)",
              color: "var(--ink-5)",
              textWrap: "pretty",
            }}
          >
            {description}
          </span>
        )}
      </div>
      <div style={{ padding: "14px 18px 18px", display: "flex", flexDirection: "column", gap: 6 }}>
        {children}
      </div>
    </div>
  );
}
