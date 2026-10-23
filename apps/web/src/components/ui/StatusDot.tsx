export type StatusDotKind = "ok" | "queued" | "warn" | "idle" | "running" | "failed" | "succeeded";

export type StatusDotProps = {
  status?: StatusDotKind;
  className?: string;
  size?: number;
};

/** Flow Studio StatusDot: 5–6px run-status dot placed after a row label or node icon. */
export function StatusDot({ status = "idle", className = "", size = 6 }: StatusDotProps) {
  const norm =
    status === "succeeded"
      ? "ok"
      : status === "running"
        ? "queued"
        : status === "failed"
          ? "warn"
          : status;
  return (
    <span
      className={`status-dot status-dot-${norm} ${className}`.trim()}
      style={{ width: size, height: size }}
      aria-hidden="true"
    />
  );
}
