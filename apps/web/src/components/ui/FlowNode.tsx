import React from "react";

export interface FlowNodeProps {
  label: string;
  status?: string | undefined;
  icon?: React.ReactNode;
  selected?: boolean;
  warn?: boolean | undefined;
  dot?: "ok" | "queued" | "warn" | "idle";
  onClick?: () => void;
}

export function FlowNode({
  label,
  status,
  icon,
  selected = false,
  warn = false,
  dot = "idle",
  onClick,
}: FlowNodeProps) {
  const ring = warn ? "var(--danger)" : selected ? "var(--ink-1)" : "var(--alpha-14)";
  return (
    <div
      onClick={onClick}
      style={{
        width: 230,
        height: 46,
        display: "flex",
        alignItems: "center",
        gap: 12,
        cursor: "pointer",
        userSelect: "none",
      }}
    >
      <div
        style={{
          position: "relative",
          width: 34,
          height: 34,
          borderRadius: "50%",
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--gray-3)",
          border: "1px solid " + ring,
          color: warn ? "var(--danger)" : "var(--accent)",
        }}
      >
        {icon}
        <span
          style={{
            position: "absolute",
            right: -1,
            bottom: -1,
            width: 7,
            height: 7,
            borderRadius: "50%",
            border: "2px solid var(--bg-card)",
            background: {
              ok: "var(--accent)",
              queued: "var(--ink-1)",
              warn: "var(--danger)",
              idle: "var(--text-disabled)",
            }[dot],
          }}
        />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0, flex: 1 }}>
        <span
          style={{
            fontSize: "var(--fs-13-5)",
            fontWeight: "var(--fw-medium)",
            color: warn ? "var(--danger)" : "var(--text-primary)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {label}
        </span>
        {status && (
          <span
            style={{
              fontSize: "var(--fs-12)",
              color: warn ? "var(--danger)" : "var(--ink-5)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {status}
          </span>
        )}
      </div>
    </div>
  );
}
