import Plotly from "plotly.js-dist-min";

import { thumbnail, themed } from "./plotlyTheme.ts";

export type PlotlyFigureJson = { data: Plotly.Data[]; layout?: Partial<Plotly.Layout> };

/** Draws a Plotly figure exactly as Python built it; only colours follow the theme. A small
 * one is a still picture for a canvas card. Returns the cleanup, which frees the chart and
 * its resize watcher (ADR-0024). */
export function drawPlotly(node: HTMLElement, figure: PlotlyFigureJson, small = false): () => void {
  const css = getComputedStyle(document.documentElement);
  const color = (token: string) => css.getPropertyValue(token).trim();
  const layout = { ...themed(figure.layout ?? {}, color), autosize: true };
  if (small) {
    const still = thumbnail({ data: figure.data, layout });
    void Plotly.react(node, still.data, still.layout, { staticPlot: true });
  } else {
    void Plotly.react(node, figure.data, layout, { displaylogo: false });
  }
  // Plotly's own `responsive` follows only the window; the box also changes with dock panels
  // and the Inline/Grid switch.
  const watcher = new ResizeObserver(() => void Plotly.Plots.resize(node));
  watcher.observe(node);
  return () => {
    watcher.disconnect();
    Plotly.purge(node);
  };
}
