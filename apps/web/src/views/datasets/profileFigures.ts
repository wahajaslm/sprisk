import type { DatasetProfile } from "@sprisk/contracts";
import type Plotly from "plotly.js-dist-min";

import type { PlotlyFigureJson } from "../drawPlotly.ts";

type Color = (token: string) => string;
type Figure = PlotlyFigureJson & { layout: Partial<Plotly.Layout> };

/** More small charts than this stop being readable; the column table still lists every column. */
export const MAX_SMALL_MULTIPLES = 24;
const PER_ROW = 3;

/** Plotly reads some HTML in text; dataset text is untrusted (rule 7), so it is shown as text. */
const text = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Where values are missing: one row per column, one cell per band of rows, red where missing. */
export function missingMap(profile: DatasetProfile, color: Color): Figure {
  const bands = profile.columns[0]?.missing_by_band.length ?? 0;
  const x = Array.from({ length: bands }, (_, i) => {
    const first = i * profile.band_rows + 1;
    return `rows ${first}–${Math.min(profile.total_rows, (i + 1) * profile.band_rows)}`;
  });
  return {
    data: [
      {
        type: "heatmap",
        z: profile.columns.map((c) => c.missing_by_band),
        x,
        y: profile.columns.map((c) => text(c.name)),
        zmin: 0,
        zmax: 1,
        colorscale: [
          [0, color("--node")],
          [1, color("--alert")],
        ],
        showscale: false,
        hovertemplate: "%{y}<br>%{x}<br>%{z:.0%} missing<extra></extra>",
      },
    ],
    layout: { title: { text: "Missing values by row band" }, xaxis: { showticklabels: false }, yaxis: { autorange: "reversed" } },
  };
}

/** Pearson correlation of the numeric columns, from -1 (red) through 0 to 1 (white). */
export function correlationField(profile: DatasetProfile, color: Color): Figure {
  const names = profile.correlation.columns.map(text);
  return {
    data: [
      {
        type: "heatmap",
        z: profile.correlation.values,
        x: names,
        y: names,
        zmin: -1,
        zmax: 1,
        colorscale: [
          [0, color("--alert")],
          [0.5, color("--node")],
          [1, color("--ink")],
        ],
        hovertemplate: "%{y} · %{x}<br>%{z:.2f}<extra></extra>",
      },
    ],
    layout: { title: { text: "Correlation field (Pearson)" }, yaxis: { autorange: "reversed" } },
  };
}

/** One small bar chart per column with values: bins of a number, or its most common values. */
export function distributions(profile: DatasetProfile, color: Color): Figure {
  const shown = profile.columns.filter((c) => c.histogram).slice(0, MAX_SMALL_MULTIPLES);
  const rows = Math.max(1, Math.ceil(shown.length / PER_ROW));
  const axis = (i: number) => (i === 0 ? "" : String(i + 1));
  return {
    data: shown.map((c, i) => ({
      type: "bar",
      x: c.histogram?.bars.map((b) => text(b.label)) ?? [],
      y: c.histogram?.bars.map((b) => b.count) ?? [],
      xaxis: `x${axis(i)}`,
      yaxis: `y${axis(i)}`,
      marker: { color: color("--soft") },
      hovertemplate: "%{x}<br>%{y}<extra></extra>",
    })),
    layout: {
      title: { text: "Distributions" },
      grid: { rows, columns: Math.min(PER_ROW, shown.length) || 1, pattern: "independent" },
      showlegend: false,
      height: 80 + rows * 150,
      // Each chart is titled by its column; tick labels would not fit.
      annotations: shown.map((c, i) => ({
        text: text(c.name),
        xref: `x${axis(i)} domain` as Plotly.XAxisName,
        yref: `y${axis(i)} domain` as Plotly.YAxisName,
        x: 0.5,
        y: 1.08,
        showarrow: false,
        font: { size: 11 },
      })),
      // Every axis is declared, so the theme reaches each chart's grid (plotlyTheme.ts).
      ...Object.fromEntries(shown.flatMap((_, i) => [[`xaxis${axis(i)}`, { showticklabels: false }], [`yaxis${axis(i)}`, { nticks: 4 }]])),
    },
  };
}
