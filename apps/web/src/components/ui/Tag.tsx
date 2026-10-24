import React from "react";

export interface TagProps {
  children?: React.ReactNode;
  tone?: "neutral" | "danger" | "default" | "queued" | "ok";
}

export function Tag({ children, tone = "neutral" }: TagProps) {
  const toneClass =
    tone === "danger"
      ? "tag-danger"
      : tone === "queued"
        ? "tag-queued"
        : tone === "ok"
          ? "tag-ok"
          : "";

  return (
    <span className={`tag ${toneClass}`}>
      {children}
    </span>
  );
}
