import Plotly from "plotly.js-dist-min";
import { useEffect, useRef } from "react";

import { themed } from "./plotlyTheme.ts";

/** Draws a Plotly figure exactly as Python built it; only colours follow the theme.
 * Lazy-loaded: plotly.js is large (ADR-0024). */
export default function PlotlyFigure({ json, label }: { json: string; label: string }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = box.current;
    if (!node) return;
    const figure = JSON.parse(json) as { data: Plotly.Data[]; layout?: Partial<Plotly.Layout> };
    const css = getComputedStyle(document.documentElement);
    const color = (token: string) => css.getPropertyValue(token).trim();
    void Plotly.react(node, figure.data, { ...themed(figure.layout ?? {}, color), autosize: true }, { responsive: true, displaylogo: false });
    return () => Plotly.purge(node);
  }, [json]);
  return <div ref={box} className="plotly-figure" role="img" aria-label={label} />;
}
