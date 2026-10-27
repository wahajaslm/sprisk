import type { ReactNode } from "react";

import { ink } from "../../styles/palette.ts";

export interface CopilotMessageProps {
  role?: "user" | "assistant";
  children?: ReactNode;
}

/** One chat line as the design draws it: the person's in a grey bubble on the right, Copilot's
 * as plain text on the left. */
export function CopilotMessage({ role = "assistant", children }: CopilotMessageProps) {
  const user = role === "user";
  return (
    <div style={{ alignSelf: user ? "flex-end" : "flex-start", maxWidth: "92%", padding: user ? "8px 11px" : "0", borderRadius: "10px", background: user ? ink(0.08) : "transparent", fontSize: "13.5px", lineHeight: "1.55", color: "var(--t-body,#e6e6e6)", whiteSpace: "pre-wrap" }}>
      {children}
    </div>
  );
}
