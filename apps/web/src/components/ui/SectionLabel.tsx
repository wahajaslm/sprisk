import type { ReactNode } from "react";

export interface SectionLabelProps {
  children: ReactNode;
  /** A two-digit position, e.g. "01", as the design numbers groups. */
  num?: string;
  /** A count or note on the right. */
  trailing?: ReactNode;
}

/** A group's label in a sidebar list: number, name, count. */
export function SectionLabel({ children, num, trailing }: SectionLabelProps) {
  return (
    <div className="side-label">
      {num && <span className="side-label-num">{num}</span>}
      <span className="side-label-name">{children}</span>
      {trailing != null && <span className="side-label-meta">{trailing}</span>}
    </div>
  );
}
