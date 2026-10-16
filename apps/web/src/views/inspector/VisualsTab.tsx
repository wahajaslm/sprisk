import type { CodeDisplay, DisplayItem } from "@sprisk/contracts";
import { type ReactNode, useState } from "react";

import type { Read } from "../../api/code.ts";
import { type ResultLayout, useResultLayout } from "../../workbench/detail.ts";
import { useEscape } from "../../hooks/useEscape.ts";
import { RowsTable } from "../RowsTable.tsx";
import { ADDED_CHARTS_NOTE } from "./StepCharts.tsx";
import { Loading } from "../../components/ui/Loading.tsx";

/** A code step's figures, in the order it drew them (Node Framework §7), then charts added to
 * the table it passes on (ADR-0030). Tables it showed are in Data. One bar, one area: Inline
 * and Grid apply to both, and switching never re-runs anything. */
export function VisualsTab({
  display,
  chartButton,
  charts,
  added,
}: {
  display: Read<CodeDisplay>;
  chartButton?: ReactNode;
  charts?: ReactNode;
  added: number;
}) {
  const { layout, setLayout } = useResultLayout();
  const [enlarged, setEnlarged] = useState<{ label: string; src: string } | undefined>();
  const items = display.status === "ready" ? display.value.items.filter((i) => i.kind !== "text" && i.kind !== "table") : [];
  let figure = 0;
  return (
    <>
      <div className="result-bar">
        <span className="spacer" />
        {chartButton}
        <LayoutSwitch layout={layout} setLayout={setLayout} />
      </div>
      {display.status === "none" && <p className="muted">{display.reason}</p>}
      {display.status === "loading" && <p className="muted">Loading…</p>}
      {display.status === "error" && <p role="alert" className="error">{display.message}</p>}
      {display.status === "ready" && items.length === 0 && added === 0 && (
        <p className="muted">No figures. Draw a plot in the code, or use Chart; tables it shows are in Data.</p>
      )}
      {added > 0 && <p className="muted">{ADDED_CHARTS_NOTE}</p>}
      <section className={`code-output ${layout}`} aria-label="Visualizations">
        {items.map((item, i) => {
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
        {charts}
      </section>
      {enlarged && <Enlarged {...enlarged} onClose={() => setEnlarged(undefined)} />}
    </>
  );
}

/** Figures the step drew, for the tab badge. Anything that is neither text nor a table counts,
 * so a broken item still shows up where its error is reported. */
export const visualCount = (display: Read<CodeDisplay>) =>
  display.status === "ready" ? display.value.items.filter((i) => i.kind !== "text" && i.kind !== "table").length : 0;

/** Tables the code showed with display() or as its last line, in order. They belong with Data. */
export const shownTables = (display: Read<CodeDisplay>): DisplayItem[] =>
  display.status === "ready" ? display.value.items.filter((i) => i.kind === "table") : [];

export function ShownTable({ item, index }: { item: DisplayItem; index: number }) {
  if (!item.table) return <p role="alert" className="error">Shown table {index + 1} has no content.</p>;
  return (
    <div className="peek">
      <div className="peek-head">{`${item.table.rows.length} of ${item.table.total_rows} rows`}</div>
      <RowsTable page={item.table} label={`shown table ${index + 1}`} />
    </div>
  );
}

export function LayoutSwitch({ layout, setLayout }: { layout: ResultLayout; setLayout: (l: ResultLayout) => void }) {
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
  useEscape(onClose);
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
