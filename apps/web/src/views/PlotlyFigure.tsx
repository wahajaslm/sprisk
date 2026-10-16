import Plotly from "plotly.js-dist-min";
import { useEffect, useRef } from "react";

/** Python's layout with Studio colours, so the figure sits in the dark theme (cockpit.css). */
function themed(layout: Partial<Plotly.Layout>): Partial<Plotly.Layout> {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(name).trim();
  const axis = { gridcolor: v("--line"), zerolinecolor: v("--line"), linecolor: v("--line") };
  return {
    ...layout,
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    font: { color: v("--soft"), family: v("--sans"), size: 12 },
    colorway: [v("--soft"), v("--dim"), v("--muted"), v("--alert")],
    // Python's axis titles and settings stay; only the colours change.
    xaxis: { ...layout.xaxis, ...axis },
    yaxis: { ...layout.yaxis, ...axis },
    margin: layout.margin ?? { l: 56, r: 24, t: 44, b: 48 },
  };
}

/** Draws a Plotly figure exactly as Python built it; only colours follow the theme.
 * Lazy-loaded: plotly.js is large (ADR-0024). */
export default function PlotlyFigure({ json, label }: { json: string; label: string }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = box.current;
    if (!node) return;
    const figure = JSON.parse(json) as { data: Plotly.Data[]; layout?: Partial<Plotly.Layout> };
    void Plotly.react(node, figure.data, { ...themed(figure.layout ?? {}), autosize: true }, { responsive: true, displaylogo: false });
    return () => Plotly.purge(node);
  }, [json]);
  return <div ref={box} className="plotly-figure" role="img" aria-label={label} />;
}
