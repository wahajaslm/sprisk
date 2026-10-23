import React from "react";

export interface IconButtonProps {
  label: string;
  children?: React.ReactNode;
  onClick?: () => void;
  active?: boolean;
}

export function IconButton({ label, children, onClick, active = false }: IconButtonProps) {
  const [h, setH] = React.useState(false);
  return (
    <button
      title={label}
      aria-label={label}
      onClick={onClick}
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      style={{
        width: 28,
        height: 28,
        borderRadius: "var(--radius-sm)",
        border: 0,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        background: h || active ? "var(--bg-hover)" : "transparent",
        color: h || active ? "var(--text-primary)" : "var(--ink-5)",
        transition: "all var(--dur-fast)",
      }}
    >
      {children}
    </button>
  );
}
