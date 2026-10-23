import React from "react";

export interface PageHeaderProps {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
}

export function PageHeader({ eyebrow, title, description, actions }: PageHeaderProps) {
  return (
    <div
      style={{
        padding: "24px 28px 20px",
        display: "flex",
        alignItems: "flex-end",
        gap: 16,
        flexWrap: "wrap",
        borderBottom: "1px solid var(--border-divider)",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
          minWidth: 0,
          flex: "1 1 220px",
        }}
      >
        {eyebrow && (
          <span style={{ fontSize: "var(--fs-12-5)", color: "var(--text-muted)" }}>
            {eyebrow}
          </span>
        )}
        <span
          style={{
            fontSize: "var(--fs-30)",
            fontWeight: 400,
            letterSpacing: "var(--ls-display)",
            lineHeight: "var(--lh-tight)",
            overflowWrap: "anywhere",
          }}
        >
          {title}
        </span>
        {description && (
          <span
            style={{
              fontSize: "var(--fs-13-5)",
              color: "var(--text-muted)",
              lineHeight: "var(--lh-body)",
              maxWidth: 640,
              textWrap: "pretty",
            }}
          >
            {description}
          </span>
        )}
      </div>
      {actions && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{actions}</div>
      )}
    </div>
  );
}
