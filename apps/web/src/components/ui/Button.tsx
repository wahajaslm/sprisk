import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "md" | "sm";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: ReactNode;
};

/** Flow Studio Button: primary (inverse white), secondary (outlined), ghost, danger. */
export function Button({
  variant = "secondary",
  size = "md",
  disabled = false,
  children,
  className = "",
  type = "button",
  ...rest
}: ButtonProps) {
  const cls = ["btn", `btn-${variant}`, `btn-${size}`, className].filter(Boolean).join(" ");
  return (
    <button type={type} disabled={disabled} className={cls} {...rest}>
      {children}
    </button>
  );
}
