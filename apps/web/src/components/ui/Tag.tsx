import type { ReactNode } from "react";

export type TagTone = "default" | "danger" | "queued" | "ok";

export type TagProps = {
  children: ReactNode;
  tone?: TagTone;
  onClick?: () => void;
  className?: string;
};

/** Flow Studio Tag: soft-filled chip for Copilot suggestions and inline labels, no outline. */
export function Tag({ children, tone = "default", onClick, className = "" }: TagProps) {
  const cls = ["tag", `tag-${tone}`, onClick ? "clickable" : "", className].filter(Boolean).join(" ");
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={cls}>
        {children}
      </button>
    );
  }
  return <span className={cls}>{children}</span>;
}
