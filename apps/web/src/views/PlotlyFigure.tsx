import { useEffect, useRef } from "react";

import { drawPlotly, type PlotlyFigureJson } from "./drawPlotly.ts";

/** A Plotly figure as Python built it. Lazy-loaded: plotly.js is large (ADR-0024). */
export default function PlotlyFigure({ json, label }: { json: string; label: string }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => (box.current ? drawPlotly(box.current, JSON.parse(json) as PlotlyFigureJson) : undefined), [json]);
  return <div ref={box} className="plotly-figure" role="img" aria-label={label} />;
}
