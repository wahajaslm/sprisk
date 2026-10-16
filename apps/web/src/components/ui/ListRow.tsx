import type { ReactNode } from "react";

/** One clickable row in a sidebar list: an optional mark, a title, a note under it, a state on the right. */
export function ListRow({
  title,
  meta,
  state,
  mark,
  current,
  pressed,
  disabled,
  mono,
  onClick,
}: {
  title: string;
  meta?: string;
  state?: ReactNode;
  mark?: ReactNode;
  current?: boolean;
  pressed?: boolean;
  disabled?: boolean;
  mono?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="list-row"
      aria-current={current ? "true" : undefined}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
    >
      {mark}
      <span className="row-main">
        <span className={mono ? "row-title mono" : "row-title"}>{title}</span>
        {meta !== undefined && <span className="row-meta">{meta}</span>}
      </span>
      {state}
    </button>
  );
}
