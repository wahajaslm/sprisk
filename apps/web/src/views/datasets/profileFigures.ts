import type { ColumnProfile, DatasetProfile } from "@sprisk/contracts";
import type Plotly from "plotly.js-dist-min";

import type { PlotlyFigureJson } from "../drawPlotly.ts";

type Color = (token: string) => string;
type Figure = PlotlyFigureJson & { layout: Partial<Plotly.Layout> };

/** Height of one horizontal bar, so a chart grows with its bars instead of squeezing them. */
const BAR_PX = 24;
const FRAME_PX = 90;
/** A chart's height when its bars do not set it. */
const CHART_PX = 280;
/** Value labels longer than this are cut: dataset text can be a whole sentence. */
const MAX_VALUE_LABEL = 40;
/** Small charts per row in the at-a-glance grid, and the height of one row. */
const PER_ROW = 3;
const ROW_PX = 190;

const cut = (s: string) => (s.length > MAX_VALUE_LABEL ? `${s.slice(0, MAX_VALUE_LABEL)}…` : s);

/** Plotly reads some HTML in text; dataset text is untrusted (rule 7), so it is shown as text. */
const text = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Missing cells and blank text per column, stacked, the emptiest on top. None when every
 * column is filled in every row. */
export function missingAndBlank(profile: DatasetProfile, color: Color): Figure | null {
  const gaps = profile.columns
    .map((c) => ({ name: c.name, missing: c.missing, blank: c.blank ?? 0 }))
    .filter((c) => c.missing + c.blank > 0)
    .sort((a, b) => b.missing + b.blank - (a.missing + a.blank));
  if (gaps.length === 0) return null;
  const rows = profile.profiled_rows;
  const y = gaps.map((g) => text(g.name));
  const share = (n: number) => (rows === 0 ? "" : `${Math.round((n / rows) * 100)}%`);
  return {
    data: [
      { type: "bar", orientation: "h", name: "Missing", y, x: gaps.map((g) => g.missing), marker: { color: color("--alert") }, text: gaps.map((g) => (g.missing ? share(g.missing) : "")), textposition: "auto", hovertemplate: "%{y}<br>%{x:,} rows missing<extra></extra>" },
      { type: "bar", orientation: "h", name: "Blank text", y, x: gaps.map((g) => g.blank), marker: { color: color("--ink-3") }, text: gaps.map((g) => (g.blank ? share(g.blank) : "")), textposition: "auto", hovertemplate: "%{y}<br>%{x:,} rows of blank text<extra></extra>" },
    ],
    layout: {
      title: { text: `Missing and blank values (of ${rows.toLocaleString()} rows)` },
      barmode: "stack",
      height: FRAME_PX + 40 + gaps.length * BAR_PX * 1.6,
      xaxis: { title: { text: "rows" }, range: [0, rows] },
      yaxis: { autorange: "reversed" },
      legend: { orientation: "h", y: -0.25 },
    },
  };
}

/** Pearson correlation of the numeric columns, from -1 (red) through 0 to 1 (white). */
export function correlationField(profile: DatasetProfile, color: Color): Figure {
  const { columns, pairs } = profile.correlation;
  const value = new Map(pairs.flatMap((p) => [[`${p.column_a}\u0000${p.column_b}`, p.pearson], [`${p.column_b}\u0000${p.column_a}`, p.pearson]]));
  // A pair with too few shared rows has no value: a gap, not a made-up number.
  const z = columns.map((a) => columns.map((b) => (a === b ? 1 : (value.get(`${a}\u0000${b}`) ?? null))));
  const names = columns.map(text);
  return {
    data: [
      {
        type: "heatmap",
        z,
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
    layout: { title: { text: "Correlation field (Pearson)" }, yaxis: { autorange: "reversed" }, height: Math.max(CHART_PX, 120 + columns.length * 36) },
  };
}

/** A category's most common values, most common on top, and the rest as one bar. */
export function valueBars(column: ColumnProfile, rows: number, color: Color, title = "Most common values"): Figure {
  const bars = column.histogram?.bars ?? [];
  const other = column.histogram?.other ?? 0;
  const label = (n: number) => {
    const share = rows === 0 ? 0 : (n / rows) * 100;
    return `${n.toLocaleString()} · ${share < 0.1 ? "<0.1" : share.toFixed(1)}%`;
  };
  return {
    data: [
      { type: "bar", orientation: "h", name: "Values", y: bars.map((b) => text(cut(b.label))), x: bars.map((b) => b.count), text: bars.map((b) => label(b.count)), textposition: "outside", cliponaxis: false, marker: { color: color("--soft") }, hovertemplate: "%{y}<br>%{x:,} rows<extra></extra>" },
      ...(other > 0
        ? [{ type: "bar" as const, orientation: "h" as const, name: "Other", y: ["Other values"], x: [other], text: [label(other)], textposition: "outside" as const, cliponaxis: false, marker: { color: color("--ink-4") }, hovertemplate: "Every other value<br>%{x:,} rows<extra></extra>" }]
        : []),
    ],
    layout: {
      title: { text: title },
      showlegend: false,
      height: FRAME_PX + (bars.length + (other > 0 ? 1 : 0)) * BAR_PX,
      xaxis: { title: { text: "rows" } },
      yaxis: { autorange: "reversed", automargin: true },
      // Room on the right for the count beside the longest bar.
      margin: { l: 8, r: 90, t: 44, b: 48 },
    },
  };
}

/** Words per value of a text column: short titles sit left, long descriptions right. */
export function wordCounts(column: ColumnProfile, color: Color): Figure {
  const bars = column.word_counts?.bars ?? [];
  return {
    data: [{ type: "bar", x: bars.map((b) => b.label), y: bars.map((b) => b.count), marker: { color: color("--soft") }, hovertemplate: "%{x} words<br>%{y:,} rows<extra></extra>" }],
    layout: { title: { text: "Words per value" }, xaxis: { title: { text: "words" }, type: "category" }, yaxis: { title: { text: "rows" } }, height: CHART_PX },
  };
}

/** A number's spread, as equal-width bins. */
export function numberBins(column: ColumnProfile, color: Color): Figure {
  const bars = column.histogram?.bars ?? [];
  return {
    data: [{ type: "bar", x: bars.map((b) => b.label), y: bars.map((b) => b.count), marker: { color: color("--soft") }, hovertemplate: "%{x}<br>%{y:,} rows<extra></extra>" }],
    layout: { title: { text: "Distribution" }, xaxis: { title: { text: text(column.name) }, type: "category" }, yaxis: { title: { text: "rows" } }, bargap: 0.05, height: CHART_PX },
  };
}

/** Where values are missing along the rows: one row per column with a gap, one cell per band
 * of rows, red where missing. A pattern (gaps that start at one row) shows here, not in a
 * count. None when no column has a missing cell. */
export function missingMap(profile: DatasetProfile, color: Color): Figure | null {
  const gappy = profile.columns.filter((c) => c.missing > 0);
  if (gappy.length === 0) return null;
  const bands = gappy[0]?.missing_by_band.length ?? 0;
  const x = Array.from({ length: bands }, (_, i) => `rows ${(i * profile.band_rows + 1).toLocaleString()}–${Math.min(profile.profiled_rows, (i + 1) * profile.band_rows).toLocaleString()}`);
  return {
    data: [
      {
        type: "heatmap",
        z: gappy.map((c) => c.missing_by_band),
        x,
        y: gappy.map((c) => text(c.name)),
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
    layout: { title: { text: "Where values are missing, by row band" }, xaxis: { showticklabels: false, title: { text: "rows, in order" } }, yaxis: { autorange: "reversed", automargin: true }, height: FRAME_PX + 40 + gappy.length * 34 },
  };
}

/** Every column at a glance, one small chart each: a number's bins, a category's most common
 * values, a text column's words per value. Identifiers, constants and empty columns have
 * nothing to show here; their cards say why. None when no column has a chart. */
export function columnsAtAGlance(profile: DatasetProfile, color: Color): Figure | null {
  const shown = profile.columns.flatMap((c) => {
    if (c.role === "identifier" || c.role === "constant" || c.role === "empty") return [];
    const bars = c.role === "text" ? c.word_counts?.bars : c.histogram?.bars.slice(0, 12);
    return bars && bars.length > 0 ? [{ title: c.role === "text" ? `${text(c.name)} · words` : text(c.name), bars }] : [];
  });
  if (shown.length === 0) return null;
  const rows = Math.ceil(shown.length / PER_ROW);
  const axis = (i: number) => (i === 0 ? "" : String(i + 1));
  return {
    data: shown.map((c, i) => ({
      type: "bar" as const,
      x: c.bars.map((b) => text(cut(b.label))),
      y: c.bars.map((b) => b.count),
      xaxis: `x${axis(i)}`,
      yaxis: `y${axis(i)}`,
      marker: { color: color("--soft") },
      hovertemplate: "%{x}<br>%{y:,} rows<extra></extra>",
    })),
    layout: {
      title: { text: "Every column at a glance" },
      grid: { rows, columns: Math.min(PER_ROW, shown.length), pattern: "independent", ygap: 0.45, xgap: 0.12 },
      showlegend: false,
      height: 70 + rows * ROW_PX,
      annotations: shown.map((c, i) => ({
        text: c.title,
        xref: `x${axis(i)} domain` as Plotly.XAxisName,
        yref: `y${axis(i)} domain` as Plotly.YAxisName,
        x: 0,
        xanchor: "left" as const,
        y: 1.12,
        showarrow: false,
        font: { size: 12 },
      })),
      // Every axis is declared, so the theme reaches each chart's grid (plotlyTheme.ts).
      ...Object.fromEntries(shown.flatMap((_, i) => [[`xaxis${axis(i)}`, { showticklabels: false, type: "category" }], [`yaxis${axis(i)}`, { nticks: 3 }]])),
    },
  };
}
