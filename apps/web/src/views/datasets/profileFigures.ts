import type { ColumnProfile, DatasetProfile } from "@sprisk/contracts";
import type Plotly from "plotly.js-dist-min";

import type { PlotlyFigureJson } from "../drawPlotly.ts";

type Color = (token: string) => string;
type Figure = PlotlyFigureJson & { layout: Partial<Plotly.Layout> };

/** Height of one horizontal bar, so a chart grows with its bars instead of squeezing them. */
const BAR_PX = 26;
const FRAME_PX = 90;

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
    layout: { title: { text: "Correlation field (Pearson)" }, yaxis: { autorange: "reversed" } },
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
      { type: "bar", orientation: "h", name: "Values", y: bars.map((b) => text(b.label)), x: bars.map((b) => b.count), text: bars.map((b) => label(b.count)), textposition: "outside", marker: { color: color("--soft") }, hovertemplate: "%{y}<br>%{x:,} rows<extra></extra>" },
      ...(other > 0
        ? [{ type: "bar" as const, orientation: "h" as const, name: "Other", y: ["Other values"], x: [other], text: [label(other)], textposition: "outside" as const, marker: { color: color("--ink-4") }, hovertemplate: "Every other value<br>%{x:,} rows<extra></extra>" }]
        : []),
    ],
    layout: {
      title: { text: title },
      showlegend: false,
      height: FRAME_PX + (bars.length + (other > 0 ? 1 : 0)) * BAR_PX,
      xaxis: { title: { text: "rows" } },
      yaxis: { autorange: "reversed", automargin: true },
    },
  };
}

/** Words per value of a text column: short titles sit left, long descriptions right. */
export function wordCounts(column: ColumnProfile, color: Color): Figure {
  const bars = column.word_counts?.bars ?? [];
  return {
    data: [{ type: "bar", x: bars.map((b) => b.label), y: bars.map((b) => b.count), marker: { color: color("--soft") }, hovertemplate: "%{x} words<br>%{y:,} rows<extra></extra>" }],
    layout: { title: { text: "Words per value" }, xaxis: { title: { text: "words" }, type: "category" }, yaxis: { title: { text: "rows" } } },
  };
}

/** A number's spread, as equal-width bins. */
export function numberBins(column: ColumnProfile, color: Color): Figure {
  const bars = column.histogram?.bars ?? [];
  return {
    data: [{ type: "bar", x: bars.map((b) => b.label), y: bars.map((b) => b.count), marker: { color: color("--soft") }, hovertemplate: "%{x}<br>%{y:,} rows<extra></extra>" }],
    layout: { title: { text: "Distribution" }, xaxis: { title: { text: text(column.name) }, type: "category" }, yaxis: { title: { text: "rows" } }, bargap: 0.05 },
  };
}
