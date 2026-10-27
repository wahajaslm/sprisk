import type { ClassificationReport } from "@sprisk/contracts";
import type Plotly from "plotly.js-dist-min";
import { useState } from "react";

import { P } from "../../styles/palette.ts";
import { formatMetric } from "../NodeFact.tsx";
import { type PlotFigure, PlotTile } from "../PlotTile.tsx";
import { tokenColor } from "../tokenColor.ts";
import { METRIC_CAPTION, METRIC_ROW, MetricTile } from "./MetricTile.tsx";

type ClassScore = ClassificationReport["per_class"][number];
type ErrorMargins = NonNullable<ClassificationReport["error_margins"]>;

const LABEL = { margin: "0", fontSize: "12.5px", fontWeight: "400", color: "var(--t-label,#959595)" } as const;
const SECTION = { display: "flex", flexDirection: "column", gap: "8px", minWidth: "0" } as const;
/** A wide table scrolls inside the panel instead of widening it. */
const SCROLL = { maxWidth: "100%", overflowX: "auto" } as const;

/** A classifier's test-set results as the evaluator reported them. The browser formats the
 * numbers and computes none of them. */
export function ModelResults({ report, previous }: { report: ClassificationReport; previous?: Record<string, number> | undefined }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "28px", minWidth: "0" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <div style={METRIC_ROW}>
          {/* Weighted F1 leads: it is the Rakuten challenge's metric. */}
          <MetricTile name="Weighted F1" value={report.weighted_f1} before={previous?.weighted_f1} />
          <MetricTile name="Macro F1" value={report.f1_macro} before={previous?.f1_macro} />
          <MetricTile name="Accuracy" value={report.accuracy} before={previous?.accuracy} />
          <MetricTile name="Balanced accuracy" value={report.balanced_accuracy} before={previous?.balanced_accuracy} />
        </div>
        <p style={METRIC_CAPTION}>
          {report.estimator} · scored on {report.n_rows} held-out rows
          {report.expected_cost !== undefined && ` · expected cost ${formatMetric(report.expected_cost)} per row`}
        </p>
      </div>
      <PerClass scores={report.per_class} />
      {report.top_confusions.length > 0 && (
        <section style={SECTION}>
          <h3 style={LABEL}>Most confused pairs</h3>
          <ul aria-label="Most confused pairs" style={{ margin: "0", padding: "0", listStyle: "none", display: "flex", flexDirection: "column", maxWidth: "480px" }}>
            {report.top_confusions.map((c) => (
              <li key={`${c.true}→${c.predicted}`} style={{ padding: "6px 0", borderBottom: "1px solid rgba(var(--ink-rgb,255,255,255),0.05)", fontSize: "13px", fontVariantNumeric: "tabular-nums", color: P.t1 }}>
                {`${c.true} → ${c.predicted} · ${c.count}`}
              </li>
            ))}
          </ul>
        </section>
      )}
      {report.error_margins && <PlotTile figure={marginFigure(report.error_margins, tokenColor)} label={MARGIN_TITLE} />}
      <Misclassified sample={report.misclassified_sample} />
    </div>
  );
}

type SortKey = "f1" | "support";

/** Weakest classes first, so the ones that need work are on top. */
function PerClass({ scores }: { scores: ClassScore[] }) {
  const [sortBy, setSortBy] = useState<SortKey>("f1");
  const sorted = [...scores].sort((a, b) => a[sortBy] - b[sortBy]);
  const sortHeader = (key: SortKey, label: string) => (
    <th scope="col" className="num" aria-sort={sortBy === key ? "ascending" : undefined}>
      <button type="button" className="dx-btn dx-h-text" onClick={() => setSortBy(key)} style={{ color: sortBy === key ? P.t0 : "var(--t-label,#959595)", fontSize: "12px" }}>
        {label}
      </button>
    </th>
  );
  return (
    <section style={SECTION}>
      <h3 style={LABEL}>Per class</h3>
      <div style={SCROLL}>
        <table className="dx-table" aria-label="Per class">
          <thead>
            <tr>
              <th scope="col">Class</th>
              <th scope="col" className="num">Precision</th>
              <th scope="col" className="num">Recall</th>
              {sortHeader("f1", "F1")}
              {sortHeader("support", "Support")}
            </tr>
          </thead>
          <tbody>
            {sorted.map((s) => (
              <tr key={s.label}>
                <td>{s.label}</td>
                <td className="num">{formatMetric(s.precision)}</td>
                <td className="num">{formatMetric(s.recall)}</td>
                <td className="num">{formatMetric(s.f1)}</td>
                <td className="num">{s.support.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const MARGIN_AXIS: Record<ErrorMargins["kind"], string> = {
  proba: "Top probability minus the runner-up",
  decision: "Size of the decision score",
  cut_off: "Distance from the cost cut-off",
};

const MARGIN_TITLE = "How close the wrong answers were";

/** The evaluator's own bins, one bar each, labelled by their edges. */
function marginFigure(margins: ErrorMargins, color: (token: string) => string): PlotFigure {
  const bins = margins.counts.map((_, i) => `${formatMetric(margins.edges[i]!)}–${formatMetric(margins.edges[i + 1]!)}`);
  const layout: Partial<Plotly.Layout> = {
    title: { text: MARGIN_TITLE },
    xaxis: { type: "category", title: { text: MARGIN_AXIS[margins.kind] } },
    yaxis: { title: { text: "wrong rows" } },
    height: 280,
  };
  return {
    data: [{ type: "bar", x: bins, y: margins.counts, marker: { color: color("--soft") }, hovertemplate: "%{x}<br>%{y:,} wrong rows<extra></extra>" }],
    layout,
  };
}

function Misclassified({ sample }: { sample: ClassificationReport["misclassified_sample"] }) {
  if (sample.n_total === 0) return <p style={METRIC_CAPTION}>No test row was misclassified.</p>;
  return (
    <section style={SECTION}>
      <h3 style={LABEL}>Misclassified rows</h3>
      <div style={SCROLL}>
        <table className="dx-table" aria-label="Misclassified rows">
          <thead>
            <tr>
              <th scope="col" className="num">Test row</th>
              <th scope="col">True</th>
              <th scope="col">Predicted</th>
              <th scope="col" className="num">Margin</th>
            </tr>
          </thead>
          <tbody>
            {sample.rows.map((r) => (
              <tr key={r.row}>
                <td className="num">{r.row}</td>
                <td>{r.true}</td>
                <td>{r.predicted}</td>
                <td className="num">{r.margin === undefined ? "—" : formatMetric(r.margin)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p style={METRIC_CAPTION}>{`${sample.rows.length} of ${sample.n_total} misclassified rows`}</p>
    </section>
  );
}
