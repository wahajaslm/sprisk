import React from "react";

export interface TagProps {
  children?: React.ReactNode;
  onClick?: () => void;
  tone?: "neutral" | "danger" | "default" | "queued" | "ok";
}

export function Tag({ children, onClick, tone = "neutral" }: TagProps) {
  const toneClass =
    tone === "danger"
      ? "tag-danger"
      : tone === "queued"
        ? "tag-queued"
        : tone === "ok"
          ? "tag-ok"
          : "";

  return (
    <span
      onClick={onClick}
      className={`tag ${toneClass} ${onClick ? "clickable" : ""}`}
    >
      {children}
    </span>
  );
}
