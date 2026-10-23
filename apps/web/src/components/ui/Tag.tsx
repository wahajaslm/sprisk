import React from "react";

export interface TagProps {
  children?: React.ReactNode;
  onClick?: () => void;
  tone?: "neutral" | "danger" | "default" | "queued" | "ok";
}

export function Tag({ children, onClick, tone = "neutral" }: TagProps) {
  const [h, setH] = React.useState(false);
  const isDanger = tone === "danger";
  const c = isDanger
    ? { background: "var(--danger-wash)", color: "var(--danger)" }
    : {
        background: h && onClick ? "var(--alpha-09)" : "var(--alpha-05)",
        color: h && onClick ? "var(--text-primary)" : "var(--ink-4)",
      };

  return (
    <span
      onClick={onClick}
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "3px 8px",
        borderRadius: "var(--radius-sm)",
        fontSize: "var(--fs-12)",
        cursor: onClick ? "pointer" : "default",
        transition: "all var(--dur-fast)",
        ...c,
      }}
    >
      {children}
    </span>
  );
}
