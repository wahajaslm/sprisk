import type { ReactNode } from "react";

export interface ButtonProps {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
  disabled?: boolean;
  children?: ReactNode;
  onClick?: () => void;
}

/** A text button for page and panel actions (Flow Studio). Its look is the .btn classes. */
export function Button({ variant = "secondary", size = "md", disabled = false, children, onClick }: ButtonProps) {
  return (
    <button type="button" className={`btn btn-${variant} btn-${size}`} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}
