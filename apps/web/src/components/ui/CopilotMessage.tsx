import type { ReactNode } from "react";

export interface CopilotMessageProps {
  role?: "user" | "assistant";
  children?: ReactNode;
}

export function CopilotMessage({ role = "assistant", children }: CopilotMessageProps) {
  return (
    <div className={`copilot-message ${role}`}>
      {children && <div className="copilot-message-body">{children}</div>}
    </div>
  );
}
