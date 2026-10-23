import type { ReactNode } from "react";
import { Chevron } from "../../views/Icons.tsx";

export type InfoDockRow = {
  k: string;
  v: ReactNode;
  warn?: boolean;
};

export type InfoDockProps = {
  title?: string;
  subtitle?: string;
  rows?: InfoDockRow[];
  open?: boolean;
  onToggle?: () => void;
  className?: string;
};

/** Flow Studio InfoDock: bottom-of-sidebar dock for selection metadata (rows, quality, version, metrics). */
export function InfoDock({
  title = "Info",
  subtitle,
  rows = [],
  open = true,
  onToggle,
  className = "",
}: InfoDockProps) {
  return (
    <div className={`info-dock ${className}`.trim()}>
      <button
        type="button"
        className="info-dock-head"
        aria-expanded={open}
        onClick={onToggle}
      >
        <span className="info-dock-title">{title}</span>
        {subtitle && <span className="info-dock-subtitle">{subtitle}</span>}
        <span className="spacer" />
        <span className={`info-dock-chevron ${open ? "open" : ""}`} aria-hidden="true">
          <Chevron />
        </span>
      </button>
      {open && rows.length > 0 && (
        <div className="info-dock-body">
          {rows.map((r, i) => (
            <div key={`${r.k}-${i}`} className="info-dock-row">
              <span className="info-dock-key">{r.k}</span>
              <span className={`info-dock-val ${r.warn ? "warn" : ""}`}>{r.v}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
