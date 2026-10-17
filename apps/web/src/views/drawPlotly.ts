import Plotly from "plotly.js-dist-min";

import { themed } from "./plotlyTheme.ts";

export type PlotlyFigureJson = { data: Plotly.Data[]; layout?: Partial<Plotly.Layout> };

/** Draws a Plotly figure exactly as Python built it; only colours follow the theme. Returns the
 * cleanup, which frees the chart and its resize listener (ADR-0024). */
export function drawPlotly(node: HTMLElement, figure: PlotlyFigureJson): () => void {
  const css = getComputedStyle(document.documentElement);
  const color = (token: string) => css.getPropertyValue(token).trim();
  void Plotly.react(node, figure.data, { ...themed(figure.layout ?? {}, color), autosize: true }, { responsive: true, displaylogo: false });
  return () => Plotly.purge(node);
}
