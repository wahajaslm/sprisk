import type { CodeDisplay, DisplayItem } from "@sprisk/contracts";
import { useState } from "react";

import type { Read } from "../../api/code.ts";
import { type ResultLayout, useResultLayout } from "../../workbench/detail.ts";
import { useEscape } from "../../hooks/useEscape.ts";
import { ink, P } from "../../styles/palette.ts";
import { ChartCard } from "../PlotTile.tsx";
import { RowsTable } from "../RowsTable.tsx";
import { BAR, FigureView, figuresLayout, QUIET, TAB } from "./FiguresTab.tsx";

/** A code step's figures, in the order its code drew them (Node Framework §7). Only code
 * decides what is shown here (ADR-0032); tables it showed are in Data. Inline or as a grid;
 * switching never re-runs anything. */
export function VisualsTab({ display, source }: { display: Read<CodeDisplay>; source: string | undefined }) {
  const { layout, setLayout } = useResultLayout();
  const [enlarged, setEnlarged] = useState<{ label: string; src: string } | undefined>();
  const items = display.status === "ready" ? display.value.items.filter((i) => i.kind !== "text" && i.kind !== "table") : [];
  let figure = 0;
  return (
    <div style={TAB}>
      <div style={BAR}>
        <span style={{ flex: "1" }} />
        <LayoutSwitch layout={layout} setLayout={setLayout} />
      </div>
      {display.status === "none" && <p style={QUIET}>{display.reason}</p>}
      {display.status === "loading" && <p style={QUIET}>Loading…</p>}
      {display.status === "error" && <p role="alert" className="error">{display.message}</p>}
      {display.status === "ready" && items.length === 0 && (
        <p style={QUIET}>No figures. Draw a plot in the code to see it here; tables it shows are in Data.</p>
      )}
      <section className={`code-output ${layout}`} aria-label="Visualizations" style={figuresLayout(layout)}>
        {items.map((item, i) => {
          if (item.kind === "figure" && item.figure) {
            figure += 1;
            return (
              <ChartCard key={i} title={item.figure.title ?? `Figure ${figure}`} note={plotCaption(figure, item.line, source)}>
                <FigureView figure={item.figure} index={figure - 1} />
              </ChartCard>
            );
          }
          if (item.kind === "image" && item.png_base64) {
            figure += 1;
            const label = `Figure ${figure}`;
            const src = `data:image/png;base64,${item.png_base64}`;
            return (
              <ChartCard key={i} title={label} note={plotCaption(figure, item.line, source)}>
                <button type="button" className="dx-btn" aria-label={`Enlarge ${label}`} onClick={() => setEnlarged({ label, src })} style={{ display: "block", width: "100%", cursor: "zoom-in", overflow: "hidden" }}>
                  <img className="figure" alt={label} src={src} style={{ display: "block", width: "100%" }} />
                </button>
              </ChartCard>
            );
          }
          return <p key={i} role="alert" className="error">Output item {i + 1} ({item.kind}) has no content.</p>;
        })}
      </section>
      {enlarged && <Enlarged {...enlarged} onClose={() => setEnlarged(undefined)} />}
    </div>
  );
}

const MAX_CAPTION_CODE = 60;
/** The design's outlined button (MethodologyTab's BUTTON). */
const BUTTON = { height: "28px", padding: "0 10px", borderRadius: "var(--r-sm,6px)", border: "1px solid rgba(var(--ink-rgb,255,255,255),0.14)", display: "flex", alignItems: "center", fontSize: "12.5px", fontWeight: "500", color: "var(--t-secondary,#d4d4d4)", cursor: "pointer" } as const;

/** Which line of the step's code showed a plot, e.g. "Plot 2 · line 5 · plt.show()". */
export function plotCaption(n: number, line: number | undefined, source: string | undefined): string {
  if (line === undefined) return `Plot ${n} · shown at the end`;
  const code = source?.split("\n")[line - 1]?.trim() ?? "";
  const cut = code.length > MAX_CAPTION_CODE ? `${code.slice(0, MAX_CAPTION_CODE)}…` : code;
  return code ? `Plot ${n} · line ${line} · ${cut}` : `Plot ${n} · line ${line}`;
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
    <div role="radiogroup" aria-label="Result layout" style={{ display: "grid", gridAutoFlow: "column", gridAutoColumns: "minmax(0,1fr)", gap: "2px", padding: "3px", borderRadius: "var(--r-md,8px)", background: ink(0.045) }}>
      {(["inline", "grid"] as const).map((l) => {
        const on = layout === l;
        return (
          <button key={l} type="button" role="radio" aria-checked={on} className="dx-btn dx-h-text" onClick={() => setLayout(l)} style={{ height: "26px", padding: "0 10px", borderRadius: "var(--r-sm,6px)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "12.5px", fontWeight: "500", cursor: "pointer", whiteSpace: "nowrap", background: on ? ink(0.1) : "transparent", color: on ? P.t0 : P.t3 }}>
            {l === "inline" ? "Inline" : "Grid"}
          </button>
        );
      })}
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
          <button type="button" className="dx-btn dx-h-06" onClick={onClose} autoFocus style={BUTTON}>
            Close
          </button>
        </figcaption>
      </figure>
    </div>
  );
}
