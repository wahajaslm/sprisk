import type Plotly from "plotly.js-dist-min";

/** Python's layout with Studio colours, so a figure sits in the dark theme (cockpit.css).
 * Axes make room for their titles and tick labels, so long names are never cut off. */
export function themed(layout: Partial<Plotly.Layout>, color: (token: string) => string): Partial<Plotly.Layout> {
  const axis = { gridcolor: color("--line"), zerolinecolor: color("--line"), linecolor: color("--line"), automargin: true };
  return {
    ...layout,
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    font: { color: color("--soft"), family: color("--sans"), size: 12 },
    colorway: [color("--soft"), color("--dim"), color("--muted"), color("--alert")],
    // Python's axis titles and settings stay; only the colours and margins change.
    xaxis: { ...layout.xaxis, ...axis },
    yaxis: { ...layout.yaxis, ...axis },
    margin: layout.margin ?? { l: 56, r: 24, t: 44, b: 48 },
  };
}
