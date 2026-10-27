import type { DatasetProfile } from "@sprisk/contracts";
import type Plotly from "plotly.js-dist-min";

import type { PlotlyFigureJson } from "../drawPlotly.ts";

type Color = (token: string) => string;
type Figure = PlotlyFigureJson & { layout: Partial<Plotly.Layout> };

/** A table a step read or wrote, by its port, with its profile. */
export type PortTable = { port: string; profile: DatasetProfile };

/** Plotly reads some HTML in text; column names are dataset text (rule 7). */
const text = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Rows each input held and each output holds: a split's sides, a filter's loss. */
export function rowsInOut(inputs: PortTable[], outputs: PortTable[], color: Color): Figure {
  const all = [...inputs.map((t) => ({ label: `in · ${t.port}`, rows: t.profile.total_rows, input: true })), ...outputs.map((t) => ({ label: `out · ${t.port}`, rows: t.profile.total_rows, input: false }))];
  // A step's tables are artifacts, always counted; a table whose total is not counted has no bar.
  const bars = all.filter((b): b is typeof b & { rows: number } => b.rows !== undefined);
  return {
    data: [
      {
        type: "bar",
        x: bars.map((b) => text(b.label)),
        y: bars.map((b) => b.rows),
        text: bars.map((b) => b.rows.toLocaleString()),
        textposition: "outside",
        marker: { color: bars.map((b) => color(b.input ? "--ink-4" : "--soft")) },
        hovertemplate: "%{x}<br>%{y:,} rows<extra></extra>",
      },
    ],
    layout: { title: { text: "Rows in and out" }, xaxis: { type: "category" }, yaxis: { title: { text: "rows" } }, height: 300 },
  };
}

/** The columns the output has that the input did not, and the ones it dropped. */
export function columnsChange(input: DatasetProfile, output: DatasetProfile): { added: string[]; removed: string[] } {
  const before = new Set(input.columns.map((c) => c.name));
  const after = new Set(output.columns.map((c) => c.name));
  return { added: [...after].filter((c) => !before.has(c)), removed: [...before].filter((c) => !after.has(c)) };
}

/** Missing values per column before and after, for the columns both tables hold that had a
 * gap on either side: what an imputer filled, or what a step left empty. */
export function missingBeforeAfter(input: DatasetProfile, output: DatasetProfile, color: Color): Figure | null {
  const after = new Map(output.columns.map((c) => [c.name, c.missing]));
  const shared = input.columns.filter((c) => after.has(c.name) && (c.missing > 0 || (after.get(c.name) ?? 0) > 0));
  if (shared.length === 0) return null;
  const y = shared.map((c) => text(c.name));
  return {
    data: [
      { type: "bar", orientation: "h", name: "Before", y, x: shared.map((c) => c.missing), marker: { color: color("--ink-4") }, hovertemplate: "%{y}<br>%{x:,} missing before<extra></extra>" },
      { type: "bar", orientation: "h", name: "After", y, x: shared.map((c) => after.get(c.name) ?? 0), marker: { color: color("--soft") }, hovertemplate: "%{y}<br>%{x:,} missing after<extra></extra>" },
    ],
    layout: { title: { text: "Missing values before and after" }, barmode: "group", yaxis: { autorange: "reversed", automargin: true }, xaxis: { title: { text: "rows" } }, height: 120 + shared.length * 44, legend: { orientation: "h", y: -0.2 } },
  };
}
