import React from "react";

export interface CopilotMessageProps {
  role?: "user" | "assistant";
  children?: React.ReactNode;
}

export function CopilotMessage({ role = "assistant", children }: CopilotMessageProps) {
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
    </div>
  );
}
