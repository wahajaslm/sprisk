import type Plotly from "plotly.js-dist-min";
import { lazy, type ReactNode, Suspense } from "react";

import { Loading } from "../components/ui/Loading.tsx";
import type { PlotlyFigureJson } from "./drawPlotly.ts";

export type PlotFigure = PlotlyFigureJson & { layout: Partial<Plotly.Layout> };

const PlotlyFigure = lazy(() => import("./PlotlyFigure.tsx"));

/** The design's grid of chart cards: as many 300px columns as fit, one when the panel is narrow. */
export const CHART_GRID = { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,300px),1fr))", gap: "16px", alignItems: "start" } as const;

/** One of the design's chart cards: a title and a note above the chart. */
export function ChartCard({ title, note, children }: { title: string; note?: ReactNode; children: ReactNode }) {
  return (
    <figure style={{ margin: "0", display: "flex", flexDirection: "column", gap: "12px", padding: "16px", borderRadius: "var(--r-lg,10px)", background: "rgba(var(--ink-rgb,255,255,255),0.03)", minWidth: "0" }}>
      <figcaption style={{ display: "flex", flexDirection: "column", gap: "3px", minWidth: "0" }}>
        <span style={{ fontSize: "14px", fontWeight: "550", color: "var(--t-primary,#f2f2f2)" }}>{title}</span>
        {note && <span style={{ fontSize: "12.5px", color: "var(--t-faint,#8c8c8c)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{note}</span>}
      </figcaption>
      {children}
    </figure>
  );
}

/** A figure the UI built from backend numbers, as a chart card; plotly.js loads on first use.
 * The card shows the title, so the chart does not draw it a second time. */
export function PlotTile({ figure, label }: { figure: PlotFigure; label: string }) {
  const { title: _title, ...layout } = figure.layout;
  return (
    <ChartCard title={label}>
      <div style={layout.height ? { height: layout.height, overflow: "hidden" } : undefined}>
        <Suspense fallback={<Loading text="Loading figure…" />}>
          <PlotlyFigure json={JSON.stringify({ ...figure, layout })} label={label} />
        </Suspense>
      </div>
    </ChartCard>
  );
}
