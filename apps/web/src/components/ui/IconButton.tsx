import type { ButtonHTMLAttributes, ReactNode } from "react";

export type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: ReactNode;
  label: string;
  size?: "md" | "sm";
  active?: boolean;
};

/** Flow Studio IconButton: accessible button with visible focus and hover states. */
export function IconButton({
  icon,
  label,
  size = "md",
  active = false,
  disabled = false,
  className = "",
  type = "button",
  title,
  ...rest
}: IconButtonProps) {
  const cls = ["icon-btn", `icon-btn-${size}`, active ? "active" : "", className].filter(Boolean).join(" ");
  return (
    <button
      type={type}
      aria-label={label}
      title={title ?? label}
      disabled={disabled}
      className={cls}
      {...rest}
    >
      {icon}
    </button>
  );
}
