import React from "react";

export interface InfoDockProps {
  title?: string;
  subtitle?: string;
  rows?: { k: string; v: React.ReactNode; warn?: boolean }[];
  open?: boolean;
  onToggle?: () => void;
}

export function InfoDock({
  title = "Info",
  subtitle,
  rows = [],
  open = true,
  onToggle,
}: InfoDockProps) {
  const [isOpen, setIsOpen] = React.useState(open);
  const handleToggle = () => {
    if (onToggle) onToggle();
    else setIsOpen((prev) => !prev);
  };
  const activeOpen = onToggle ? open : isOpen;

  return (
    <div style={{ borderTop: "1px solid var(--border-panel)", display: "flex", flexDirection: "column" }}>
      <div
        onClick={handleToggle}
        style={{
          height: 40,
          padding: "0 16px",
          display: "flex",
          alignItems: "center",
          gap: 8,
          cursor: "pointer",
          userSelect: "none",
        }}
      >
        <span style={{ fontSize: "var(--fs-13-5)", fontWeight: "var(--fw-medium)" }}>{title}</span>
        {subtitle && (
          <span
            style={{
              flex: 1,
              minWidth: 0,
              fontSize: "var(--fs-12-5)",
              color: "var(--ink-6)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {subtitle}
          </span>
        )}
        <span style={{ flex: 1 }} />
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          stroke="var(--text-muted)"
          strokeWidth="1.3"
          strokeLinecap="round"
          style={{
            transform: activeOpen ? "none" : "rotate(180deg)",
            transition: "transform var(--dur-fast)",
          }}
        >
          <path d="M2.5 6.25L5 3.75l2.5 2.5" />
        </svg>
      </div>

      {activeOpen && (
        <div style={{ padding: "0 16px 14px", maxHeight: 240, overflow: "auto" }}>
          {rows.map((r) => (
            <div
              key={r.k}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                gap: 12,
                padding: "6px 0",
                borderBottom: "1px solid var(--alpha-04)",
              }}
            >
              <span
                style={{
                  fontSize: "var(--fs-12-5)",
                  color: "var(--text-label)",
                  whiteSpace: "nowrap",
                }}
              >
                {r.k}
              </span>
              <span
                style={{
                  fontSize: "var(--fs-13)",
                  color: r.warn ? "var(--danger)" : "var(--text-body)",
                  fontVariantNumeric: "tabular-nums",
                  textAlign: "right",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {r.v}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
