import type Plotly from "plotly.js-dist-min";

/** Flow Studio monochromatic chart palette.
 * Primary: light #f2f2f2 (--ink-0)
 * Secondary: grey #5a5a5a (--ink-4)
 * Tertiary: mid-grey #8a8a8a (--ink-3)
 * Alert / Threshold: #ff5c5c (--danger)
 */
export const FLOW_CHART_COLORS = {
  primary: "#f2f2f2",
  secondary: "#5a5a5a",
  tertiary: "#8a8a8a",
  threshold: "#ff5c5c",
};

/** Flow Studio layout styling for Plotly charts in dark monochromatic theme. */
export function themed(layout: Partial<Plotly.Layout>, color: (token: string) => string): Partial<Plotly.Layout> {
  const gridColor = color("--alpha-06") || "rgba(255, 255, 255, 0.06)";
  const lineCol = color("--alpha-08") || "rgba(255, 255, 255, 0.08)";
  const fontColor = color("--ink-3") || "#8a8a8a";
  const fontFamily = color("--sans") || "Instrument Sans, -apple-system, sans-serif";

  const primaryCol = color("--ink-0") || FLOW_CHART_COLORS.primary;
  const secondaryCol = color("--ink-4") || FLOW_CHART_COLORS.secondary;
  const tertiaryCol = color("--ink-3") || FLOW_CHART_COLORS.tertiary;
  const dangerCol = color("--danger") || FLOW_CHART_COLORS.threshold;

  const axis = {
    gridcolor: gridColor,
    zerolinecolor: lineCol,
    linecolor: lineCol,
    automargin: true,
    tickfont: { color: fontColor, family: fontFamily, size: 11 },
    titlefont: { color: fontColor, family: fontFamily, size: 12 },
  };

  return {
    ...layout,
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    font: { color: fontColor, family: fontFamily, size: 12 },
    colorway: [primaryCol, secondaryCol, tertiaryCol, dangerCol],
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

/** 1px dashed red threshold line shape helper for Plotly layouts */
export function thresholdLine(y: number, colorVal = FLOW_CHART_COLORS.threshold): Partial<Plotly.Shape> {
  return {
    type: "line",
    xref: "paper",
    x0: 0,
    x1: 1,
    y0: y,
    y1: y,
    line: {
      color: colorVal,
      width: 1,
      dash: "dash",
    },
  };
}

type Figure = { data: Plotly.Data[]; layout: Partial<Plotly.Layout> };

/** A themed figure cut down for a canvas card: just marks and grid. */
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
