import React from "react";

export interface SidebarProps {
  title: string;
  meta?: string;
  search?: React.ReactNode;
  children?: React.ReactNode;
  dock?: React.ReactNode;
  width?: number | string;
}

export function Sidebar({
  title,
  meta,
  search,
  children,
  dock,
  width = "var(--size-sidebar)",
}: SidebarProps) {
  return (
    <div
      style={{
        width,
        background: "var(--bg-surface)",
        borderRight: "1px solid var(--border-panel)",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        height: "100%",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "18px 16px 12px",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
          }}
        >
          <span style={{ fontSize: "var(--fs-15)", fontWeight: "var(--fw-medium)" }}>
            {title}
          </span>
          {meta && (
            <span
              style={{
                fontSize: "var(--fs-12-5)",
                color: "var(--text-label)",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {meta}
            </span>
          )}
        </div>
        {search}
      </div>
      <div
        style={{
          flex: 1,
          overflow: "auto",
          padding: "0 8px 12px",
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        {children}
      </div>
      {dock}
    </div>
  );
}
