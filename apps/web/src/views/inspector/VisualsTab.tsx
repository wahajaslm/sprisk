import type { CodeDisplay } from "@sprisk/contracts";
import { useEffect, useState } from "react";

import type { Read } from "../../api/code.ts";
import { type ResultLayout, useResultLayout } from "../../workbench/detail.ts";
import { RowsTable } from "../RowsTable.tsx";

/** Figures and displayed tables, in the order the step showed them (Node Framework §7).
 * Inline or as a grid; switching never re-runs anything. */
export function VisualsTab({ display, isCode }: { display: Read<CodeDisplay>; isCode: boolean }) {
  const { layout, setLayout } = useResultLayout();
  const [enlarged, setEnlarged] = useState<{ label: string; src: string } | undefined>();
  if (!isCode) return <p className="muted">Built-in steps draw no figures. Their tables are in Data.</p>;
  if (display.status === "none") return <p className="muted">{display.reason}</p>;
  if (display.status === "loading") return <p className="muted">Loading…</p>;
  if (display.status === "error") return <p role="alert" className="error">{display.message}</p>;
  const items = display.value.items.filter((i) => i.kind !== "text");
  if (items.length === 0) {
    return <p className="muted">Nothing to draw. Use <code>display(df)</code>, a plot, or end the code with a table.</p>;
  }
  let figure = 0;
  return (
    <>
      <div className="result-bar">
        <LayoutSwitch layout={layout} setLayout={setLayout} />
      </div>
      <section className={`code-output ${layout}`} aria-label="Visualizations">
        {items.map((item, i) => {
          if (item.kind === "table" && item.table) {
            return (
              <div key={i} className="peek result-tile">
                <RowsTable page={item.table} label={`table ${i + 1}`} />
                <div className="peek-foot">{`${item.table.rows.length} of ${item.table.total_rows} rows`}</div>
              </div>
            );
          }
          if (item.kind === "image" && item.png_base64) {
            figure += 1;
            const label = `Figure ${figure}`;
            const src = `data:image/png;base64,${item.png_base64}`;
            return (
              <button key={i} type="button" className="figure-button result-tile" aria-label={`Enlarge ${label}`} onClick={() => setEnlarged({ label, src })}>
                <img className="figure" alt={label} src={src} />
              </button>
            );
          }
          return <p key={i} role="alert" className="error">Output item {i + 1} ({item.kind}) has no content.</p>;
        })}
      </section>
      {enlarged && <Enlarged {...enlarged} onClose={() => setEnlarged(undefined)} />}
    </>
  );
}

/** Figures and tables the step displayed, for the tab badge. */
export const visualCount = (display: Read<CodeDisplay>) =>
  display.status === "ready" ? display.value.items.filter((i) => i.kind !== "text").length : 0;

function LayoutSwitch({ layout, setLayout }: { layout: ResultLayout; setLayout: (l: ResultLayout) => void }) {
  return (
    <div className="detail-switch small" role="radiogroup" aria-label="Result layout">
      {(["inline", "grid"] as const).map((l) => (
        <button key={l} type="button" role="radio" aria-checked={layout === l} onClick={() => setLayout(l)}>
          {l === "inline" ? "Inline" : "Grid"}
        </button>
      ))}
    </div>
  );
}

/** One figure, large, over everything. Escape or a click outside closes it. */
function Enlarged({ label, src, onClose }: { label: string; src: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label={label} onClick={onClose}>
      <figure onClick={(e) => e.stopPropagation()}>
        <img src={src} alt={label} />
        <figcaption>
          {label}
          <button type="button" className="page-btn" onClick={onClose} autoFocus>
            Close
          </button>
        </figcaption>
      </figure>
    </div>
  );
}
