import React from "react";

export interface ListRowProps {
  title: string;
  meta?: string;
  trailing?: React.ReactNode;
  status?: "ok" | "queued" | "warn" | "idle";
  selected?: boolean;
  warn?: boolean;
  onClick?: () => void;

  // Compatibility props
  mono?: boolean;
  mark?: React.ReactNode;
  state?: React.ReactNode;
  current?: boolean;
  pressed?: boolean;
  disabled?: boolean;
}

export function ListRow({
  title,
  meta,
  trailing,
  status,
  selected = false,
  warn = false,
  onClick,
  mono = false,
  mark,
  state,
  current,
  pressed,
  disabled = false,
}: ListRowProps) {
  const [h, setH] = React.useState(false);
  const isSelected = selected || current || pressed;
  const two = meta != null;

  return (
    <div
      onClick={disabled ? undefined : onClick}
      onMouseEnter={() => !disabled && setH(true)}
      onMouseLeave={() => !disabled && setH(false)}
      style={{
        borderRadius: "var(--radius-sm)",
        padding: two ? "8px 10px" : "0 10px",
        height: two ? "auto" : "var(--size-row)",
        display: "flex",
        flexDirection: two ? "column" : "row",
        alignItems: two ? "stretch" : "center",
        gap: two ? 2 : 10,
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.45 : 1,
        minWidth: 0,
        background: isSelected ? "var(--bg-selected)" : h ? "var(--bg-hover)" : "transparent",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 8,
          minWidth: 0,
          flex: two ? "none" : 1,
        }}
      >
        {mark && <span style={{ flexShrink: 0 }}>{mark}</span>}
        <span
          style={{
            flex: 1,
            minWidth: 0,
            fontFamily: mono ? "var(--font-mono)" : "inherit",
            fontSize: two ? "var(--fs-14)" : "var(--fs-13-5)",
            fontWeight: two ? "var(--fw-book)" : 400,
            color: warn ? "var(--danger)" : isSelected ? "var(--text-strong)" : "var(--text-body)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {title}
        </span>
        {state && <span style={{ flexShrink: 0 }}>{state}</span>}
        {trailing != null && (
          <span
            style={{
              fontSize: "var(--fs-12-5)",
              color: "var(--text-faint)",
              fontVariantNumeric: "tabular-nums",
              flexShrink: 0,
            }}
          >
            {trailing}
          </span>
        )}
        {status && !two && (
          <span
            style={{
              width: 5,
              height: 5,
              borderRadius: 3,
              flexShrink: 0,
              alignSelf: "center",
              background: {
                ok: "var(--accent)",
                queued: "var(--text-primary)",
                warn: "var(--danger)",
                idle: "var(--text-disabled)",
              }[status],
            }}
          />
        )}
      </div>
      {two && (
        <span
          style={{
            fontSize: "var(--fs-12-5)",
            color: "var(--ink-5)",
            fontVariantNumeric: "tabular-nums",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {meta}
        </span>
      )}
    </div>
  );
}
