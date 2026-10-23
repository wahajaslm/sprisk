import React from "react";

const COLORS = {
  ok: "var(--accent)",
  queued: "var(--text-primary)",
  warn: "var(--danger)",
  idle: "var(--text-disabled)",
};

export interface StatusDotProps {
  status?: "ok" | "queued" | "warn" | "idle";
  size?: number;
}

export function StatusDot({ status = "idle", size = 6 }: StatusDotProps) {
  return (
    <span
      style={{
        display: "inline-block",
        width: size,
        height: size,
        borderRadius: size,
        background: COLORS[status],
        flexShrink: 0,
      }}
    />
  );
}
