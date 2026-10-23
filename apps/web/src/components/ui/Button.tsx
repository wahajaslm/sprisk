import React from "react";

export interface ButtonProps {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
  disabled?: boolean;
  children?: React.ReactNode;
  onClick?: () => void;
  style?: React.CSSProperties;
}

export function Button({
  variant = "secondary",
  size = "md",
  disabled = false,
  children,
  onClick,
  style,
}: ButtonProps) {
  const [h, setH] = React.useState(false);
  const v = {
    primary: {
      background: h ? "var(--ink-0)" : "var(--bg-inverse)",
      color: "var(--text-inverse)",
      fontWeight: "var(--fw-semibold)",
    },
    secondary: {
      border: "1px solid " + (h ? "var(--border-control-hover)" : "var(--border-control)"),
      color: "var(--text-secondary)",
    },
    ghost: {
      background: h ? "var(--bg-hover)" : "transparent",
      color: h ? "var(--text-primary)" : "var(--text-muted)",
    },
    danger: {
      border: "1px solid rgba(255,92,92," + (h ? 0.7 : 0.4) + ")",
      color: "var(--danger)",
    },
  }[variant];

  return (
    <button
      disabled={disabled}
      onClick={onClick}
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      style={{
        height: size === "sm" ? 28 : "var(--size-control)",
        padding: "0 12px",
        borderRadius: "var(--radius-sm)",
        border: "1px solid transparent",
        background: "transparent",
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        fontFamily: "var(--font-sans)",
        fontSize: "var(--fs-13)",
        fontWeight: "var(--fw-medium)",
        whiteSpace: "nowrap",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.4 : 1,
        transition: "all var(--dur-fast)",
        ...v,
        ...style,
      }}
    >
      {children}
    </button>
  );
}
