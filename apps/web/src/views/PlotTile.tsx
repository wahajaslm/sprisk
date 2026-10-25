import type Plotly from "plotly.js-dist-min";
import { lazy, Suspense } from "react";

import { Loading } from "../components/ui/Loading.tsx";
import type { PlotlyFigureJson } from "./drawPlotly.ts";

export type PlotFigure = PlotlyFigureJson & { layout: Partial<Plotly.Layout> };

const PlotlyFigure = lazy(() => import("./PlotlyFigure.tsx"));

/** A figure the UI built from backend numbers, as a tile; plotly.js loads on first use. */
export function PlotTile({ figure, label }: { figure: PlotFigure; label: string }) {
  return (
    <figure className="result-tile plot" style={figure.layout.height ? { height: figure.layout.height, minHeight: 0 } : undefined}>
      <Suspense fallback={<Loading text="Loading figure…" />}>
        <PlotlyFigure json={JSON.stringify(figure)} label={label} />
      </Suspense>
    </figure>
  );
}
