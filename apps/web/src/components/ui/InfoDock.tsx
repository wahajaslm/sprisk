import type { ReactNode } from "react";

export interface InfoDockProps {
  rows: { k: string; v: ReactNode; warn?: boolean }[];
}

/** The facts at the foot of a sidebar about what is picked, titled "Info" on every page (design). */
export function InfoDock({ rows }: InfoDockProps) {
  return (
    <section className="info-dock" aria-label="Info">
      <h3 className="info-dock-title">Info</h3>
      {rows.map((r) => (
        <div key={r.k} className="info-dock-row">
          <span className="info-dock-key">{r.k}</span>
          <span className={`info-dock-val${r.warn ? " warn" : ""}`}>{r.v}</span>
        </div>
      ))}
    </section>
  );
}
