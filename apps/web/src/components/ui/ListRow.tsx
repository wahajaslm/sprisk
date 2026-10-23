import type { ReactNode } from "react";
import { StatusDot, type StatusDotKind } from "./StatusDot.tsx";

export type ListRowProps = {
  title: string;
  meta?: string;
  trailing?: ReactNode;
  state?: ReactNode;
  status?: StatusDotKind | string;
  mark?: ReactNode;
  selected?: boolean;
  current?: boolean;
  pressed?: boolean;
  warn?: boolean;
  disabled?: boolean;
  mono?: boolean;
  onClick: () => void;
  className?: string;
};

/** Flow Studio ListRow: 1-line or 2-line clickable row. Hover 5% white, selected 8% white, 6px radius, no border. */
export function ListRow({
  title,
  meta,
  trailing,
  state,
  status,
  mark,
  selected = false,
  current,
  pressed,
  warn = false,
  disabled = false,
  mono = false,
  onClick,
  className = "",
}: ListRowProps) {
  const isSelected = selected || current || pressed;
  const isTwoLine = meta !== undefined;

  const rightSide = trailing ?? state ?? (status ? <StatusDot status={status as StatusDotKind} /> : null);

  return (
    <button
      type="button"
      className={`list-row ${isTwoLine ? "two-line" : "one-line"} ${isSelected ? "selected" : ""} ${warn ? "warn" : ""} ${className}`.trim()}
      aria-current={isSelected ? "true" : undefined}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
    >
      {mark}
      <span className="row-main">
        <span className={`row-title ${mono ? "mono" : ""}`.trim()}>{title}</span>
        {isTwoLine && <span className="row-meta">{meta}</span>}
      </span>
      {rightSide && <span className="row-trailing">{rightSide}</span>}
    </button>
  );
}
