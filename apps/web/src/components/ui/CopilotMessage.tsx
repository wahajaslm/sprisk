import React from "react";

export interface CopilotMessageProps {
  role?: "user" | "assistant";
  children?: React.ReactNode;
  card?: {
    title: string;
    rows: { k: string; v: string; warn?: boolean }[];
    foot?: string;
  };
}

export function CopilotMessage({ role = "assistant", children, card }: CopilotMessageProps) {
  const user = role === "user";
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: user ? "flex-end" : "flex-start",
        gap: 8,
      }}
    >
      {children && (
        <div
          style={{
            maxWidth: "94%",
            padding: user ? "9px 12px" : 0,
            borderRadius: 10,
            background: user ? "var(--gray-7)" : "transparent",
            color: user ? "var(--text-primary)" : "var(--text-body)",
            fontSize: "var(--fs-14-5)",
            lineHeight: "var(--lh-relaxed)",
            textWrap: "pretty",
            whiteSpace: "pre-wrap",
          }}
        >
          {children}
        </div>
      )}
      {card && (
        <div
          style={{
            alignSelf: "stretch",
            borderTop: "1px solid var(--border-input)",
            borderBottom: "1px solid var(--border-input)",
          }}
        >
          <div
            style={{
              padding: "10px 0 6px",
              fontSize: "var(--fs-13-5)",
              fontWeight: "var(--fw-medium)",
            }}
          >
            {card.title}
          </div>
          {card.rows.map((r) => (
            <div
              key={r.k}
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
                padding: "5px 0",
                fontSize: "var(--fs-13)",
              }}
            >
              <span style={{ color: "var(--text-muted)" }}>{r.k}</span>
              <span
                style={{
                  color: r.warn ? "var(--danger)" : "var(--text-primary)",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {r.v}
              </span>
            </div>
          ))}
          {card.foot && (
            <div
              style={{
                padding: "8px 0",
                borderTop: "1px solid var(--border-divider)",
                fontSize: "var(--fs-12-5)",
                color: "var(--text-label)",
              }}
            >
              {card.foot}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
