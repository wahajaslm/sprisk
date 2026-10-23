import React from "react";

export interface SectionLabelProps {
  children?: React.ReactNode;
  trailing?: React.ReactNode;
  collapsible?: boolean;
  open?: boolean;
  onToggle?: () => void;
}

export function SectionLabel({
  children,
  trailing,
  collapsible = false,
  open = true,
  onToggle,
}: SectionLabelProps) {
  return (
    <div
      onClick={collapsible ? onToggle : undefined}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "0 10px 4px",
        fontSize: "var(--fs-12-5)",
        color: "var(--ink-6)",
        cursor: collapsible ? "pointer" : "default",
        userSelect: "none",
      }}
    >
      <span>{children}</span>
      {collapsible && (
        <svg
          width="9"
          height="9"
          viewBox="0 0 10 10"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
          style={{
            transform: open ? "none" : "rotate(-90deg)",
            transition: "transform var(--dur-fast)",
          }}
        >
          <path d="M2.5 3.75L5 6.25l2.5-2.5" />
        </svg>
      )}
      <span style={{ flex: 1 }} />
      {trailing != null && (
        <span style={{ fontSize: "var(--fs-12)", fontVariantNumeric: "tabular-nums" }}>
          {trailing}
        </span>
      )}
    </div>
  );
}
