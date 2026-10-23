import React from "react";

export interface InfoDockProps {
  title?: string;
  subtitle?: string;
  rows?: { k: string; v: React.ReactNode; warn?: boolean }[];
  open?: boolean;
  onToggle?: () => void;
}

export function InfoDock({
  title = "Info",
  subtitle,
  rows = [],
  open = true,
  onToggle,
}: InfoDockProps) {
  const [isOpen, setIsOpen] = React.useState(open);
  const handleToggle = () => {
    if (onToggle) onToggle();
    else setIsOpen((prev) => !prev);
  };
  const activeOpen = onToggle ? open : isOpen;

  return (
    <div className="info-dock">
      <button
        type="button"
        className="info-dock-head"
        onClick={handleToggle}
        aria-expanded={activeOpen}
      >
        <span className="info-dock-title">{title}</span>
        {subtitle && <span className="info-dock-subtitle">{subtitle}</span>}
        <span style={{ flex: 1 }} />
        <span className={`info-dock-chevron ${activeOpen ? "" : "open"}`}>
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
            <path d="M2.5 6.25L5 3.75l2.5 2.5" />
          </svg>
        </span>
      </button>

      {activeOpen && (
        <div className="info-dock-body">
          {rows.map((r) => (
            <div key={r.k} className="info-dock-row">
              <span className="info-dock-key">{r.k}</span>
              <span className={`info-dock-val ${r.warn ? "warn" : ""}`}>{r.v}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
