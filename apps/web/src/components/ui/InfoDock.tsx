import type { ReactNode } from "react";

export interface InfoDockProps {
  title?: string;
  subtitle?: string;
  rows: { k: string; v: ReactNode; warn?: boolean }[];
}

/** The facts at the foot of a sidebar: a few name and value pairs about what is picked. */
export function InfoDock({ title = "Info", subtitle, rows }: InfoDockProps) {
  return (
    <section className="info-dock" aria-label={title}>
      <h3 className="info-dock-title">
        {title}
        {subtitle && <span className="info-dock-subtitle"> {subtitle}</span>}
      </h3>
      {rows.map((r) => (
        <div key={r.k} className="info-dock-row">
          <span className="info-dock-key">{r.k}</span>
          <span className={`info-dock-val${r.warn ? " warn" : ""}`}>{r.v}</span>
        </div>
      ))}
    </section>
  );
}
