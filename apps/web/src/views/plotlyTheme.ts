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
    // Python's axis titles and settings stay; only the colours and margins change. Subplots
    // have their own axes (xaxis2, yaxis3, …), themed the same.
    ...Object.fromEntries(
      Object.entries(layout)
        .filter(([key]) => /^[xy]axis\d+$/.test(key))
        .map(([key, value]) => [key, { ...(value as object), ...axis }]),
    ),
    xaxis: { ...layout.xaxis, ...axis },
    yaxis: { ...layout.yaxis, ...axis },
    margin: layout.margin ?? { l: 56, r: 24, t: 44, b: 48 },
  };
}

type Figure = { data: Plotly.Data[]; layout: Partial<Plotly.Layout> };

/** A themed figure cut down for a canvas card: just the marks and the grid. Words, legends
 * and colour bars cannot be read at that size; the Inspector shows them. */
export function thumbnail({ data, layout }: Figure): Figure {
  const { title: _title, width: _width, height: _height, ...rest } = layout;
  const bare = { showticklabels: false, automargin: false, title: { text: "" } };
  return {
    data: data.map((trace) => ({ ...trace, showscale: false }) as Plotly.Data),
    layout: {
      ...rest,
      autosize: true,
      showlegend: false,
      xaxis: { ...layout.xaxis, ...bare },
      yaxis: { ...layout.yaxis, ...bare },
      margin: { l: 2, r: 2, t: 2, b: 2 },
    },
  };
}
