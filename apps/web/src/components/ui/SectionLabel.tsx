import type { ReactNode } from "react";
import { Chevron } from "../../views/Icons.tsx";

export type SectionLabelProps = {
  children: ReactNode;
  collapsible?: boolean;
  open?: boolean;
  onToggle?: () => void;
  trailing?: ReactNode;
  count?: number | string;
  stepNumber?: string;
  className?: string;
};

/** Flow Studio SectionLabel: 12.5px group heading above ListRows, collapsible. */
export function SectionLabel({
  children,
  collapsible = false,
  open = true,
  onToggle,
  trailing,
  count,
  stepNumber,
  className = "",
}: SectionLabelProps) {
  const content = (
    <>
      {collapsible && (
        <span className={`section-label-chevron ${open ? "open" : ""}`} aria-hidden="true">
          <Chevron />
        </span>
      )}
      {stepNumber && <span className="section-label-num">{stepNumber}</span>}
      <span className="section-label-title">{children}</span>
      {count !== undefined && <span className="section-label-count">{count}</span>}
      <span className="spacer" />
      {trailing && <span className="section-label-trailing">{trailing}</span>}
    </>
  );

  if (collapsible) {
    return (
      <button
        type="button"
        className={`section-label collapsible ${className}`.trim()}
        aria-expanded={open}
        onClick={onToggle}
      >
        {content}
      </button>
    );
  }

  return <div className={`section-label ${className}`.trim()}>{content}</div>;
}
