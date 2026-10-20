import type { AttemptOutput, TablePage } from "@sprisk/contracts";
import { parse } from "@sprisk/contracts";

import { useArtifactText, useOutputs, useTablePage } from "../api/hooks.ts";
import { PARQUET } from "../api/media.ts";
import { useNodeHistory } from "../api/history.ts";
import { isCodeOperator } from "../flow/edit.ts";
import {
  isClipOutliersOperator,
  isClusteringOperator,
  isDistributionsOperator,
  isFeatureImportanceOperator,
  isProfileOperator,
  isSpectralGatingOperator,
} from "../flow/stages.ts";
import { formatMetric, headlineMetric } from "./NodeFact.tsx";
import { FigureView } from "./inspector/FiguresTab.tsx";
import { MAX_FIGURE_BYTES, useFirstFigure } from "../api/figures.ts";

/** Thumbnails are only read when small; bigger figures stay in the Inspector. */
const MAX_THUMB_SOURCE_BYTES = 1024 * 1024;

export type VisualFor = {
  attemptId: string;
  operator: string;
  capability: string;
  params: Record<string, unknown>;
  pipelineVersionId: string | undefined;
  nodeId: string;
  /** An evaluator's metrics port. */
  metricsPort?: string | undefined;
};


function SpectralGatingVisual({ artifactId, params }: { artifactId: string; params: Record<string, unknown> }) {
  const page = useTablePage(artifactId, 0, 100);
  const thresh = typeof params.threshold_db === "number" ? params.threshold_db : -6;
  const atten = typeof params.attenuation_factor === "number" ? params.attenuation_factor : 0.15;

  let gatedPct = "50%";
  if (page.data) {
    const gainIdx = page.data.columns.findIndex((c) => c.name.toLowerCase().includes("gain") || c.name.toLowerCase().includes("gate"));
    if (gainIdx >= 0) {
      const total = page.data.rows.length;
      const attenuated = page.data.rows.filter((r) => parseFloat(r.values[gainIdx] ?? "1") < 1.0).length;
      if (total > 0) {
        gatedPct = `${Math.round((attenuated / total) * 100)}%`;
      }
    }
  }

  return (
    <div className="nv nv-spectral" aria-label={`spectral gating threshold ${thresh} dB`}>
      <div className="nv-legend">
        <span>threshold: <b>{thresh} dB</b></span>
        <span>attenuated: <b>{gatedPct}</b></span>
        <span>floor: <b>{atten}×</b></span>
      </div>
    </div>
  );
}

function CardFigurePreview({ artifactId }: { artifactId: string }) {
  const first = useFirstFigure(artifactId);
  if (first.isPending) return <VisualSkeleton />;
  const figure = first.data?.items[0];
  if (!figure) return null;
  return (
    <span className="card-figure">
      <FigureView figure={figure} index={0} small />
    </span>
  );
}

/** A small picture of a step's main output, chosen from what the step produced. */
export function NodeVisual(props: VisualFor) {
  const outputs = useOutputs(props.attemptId);
  const all = outputs.data ?? [];
  const tables = all.filter((o) => o.artifact.media_type === PARQUET);
  const figureOutput = all.find((o) => o.port === "figures" || o.port === "chart")?.artifact;

  if (isFeatureImportanceOperator(props.operator)) return <FeatureImportanceVisual outputs={all} />;
  if (props.capability === "evaluator" && props.metricsPort) return <MetricTrend {...props} />;
  if (isCodeOperator(props.operator)) return <CodeThumb outputs={all} />;
  if (figureOutput && figureOutput.size_bytes <= MAX_FIGURE_BYTES) return <CardFigurePreview artifactId={figureOutput.id} />;
  if (isDistributionsOperator(props.operator)) return <DistributionsVisual outputs={all} />;
  if (isClusteringOperator(props.operator) && tables[0]) return <ClusterVisual artifactId={tables[0].artifact.id} params={props.params} />;
  if (isSpectralGatingOperator(props.operator) && tables[0]) return <SpectralGatingVisual artifactId={tables[0].artifact.id} params={props.params} />;
  if (isClipOutliersOperator(props.operator)) return <ClipOutliersVisual params={props.params} />;
  if (isProfileOperator(props.operator) && tables[0]) return <MissingBars artifactId={tables[0].artifact.id} />;
  if (props.capability === "evaluator") return <MetricTrend {...props} />;
  if (props.capability === "estimator") return <ModelSummary params={props.params} />;
  if (tables.length >= 2) return <SplitBar outputs={tables} params={props.params} />;
  if (tables[0]) return <ColumnTypes artifactId={tables[0].artifact.id} />;
  return null;
}

/** Clustering Analysis (kmeans, dbscan, gmm): stacked cluster proportion bar with cluster breakdown */
function ClusterVisual({ artifactId, params }: { artifactId: string; params: Record<string, unknown> }) {
  const page = useTablePage(artifactId, 0, 200);
  if (!page.data) return <VisualSkeleton />;

  const clusterColIdx = page.data.columns.findIndex((c) => c.name.toLowerCase() === "cluster");
  if (clusterColIdx === -1) return <ColumnTypes artifactId={artifactId} />;

  const counts = new Map<number, number>();
  let noiseCount = 0;
  for (const row of page.data.rows) {
    const rawVal = row.values[clusterColIdx];
    const val = Number(rawVal);
    if (!isNaN(val)) {
      if (val === -1) noiseCount++;
      else counts.set(val, (counts.get(val) ?? 0) + 1);
    }
  }

  const total = page.data.rows.length || 1;
  const sortedClusters = Array.from(counts.entries()).sort((a, b) => a[0] - b[0]);
  const k = sortedClusters.length || (typeof params.n_clusters === "number" ? params.n_clusters : undefined);
  const noisePct = Math.round((noiseCount / total) * 100);

  const colors = [
    "var(--kind-source)",
    "var(--kind-recipe)",
    "var(--kind-model)",
    "var(--kind-view)",
    "var(--kind-decision)",
  ];

  return (
    <div className="nv nv-cluster" aria-label={`clustering, ${k ?? 0} clusters`}>
      <div className="nv-cluster-bar" role="img" aria-label="Cluster distribution">
        {sortedClusters.map(([cid, count], i) => {
          const widthPct = (count / total) * 100;
          return (
            <span
              key={cid}
              className="nv-cluster-seg"
              style={{
                width: `${widthPct}%`,
                backgroundColor: colors[i % colors.length],
              }}
              title={`Cluster ${cid}: ${count} (${Math.round(widthPct)}%)`}
            />
          );
        })}
        {noiseCount > 0 && (
          <span
            className="nv-cluster-seg nv-cluster-noise"
            style={{ width: `${(noiseCount / total) * 100}%` }}
            title={`Noise: ${noiseCount} (${noisePct}%)`}
          />
        )}
      </div>
      <div className="nv-cluster-pills">
        {sortedClusters.slice(0, 3).map(([cid, count], i) => (
          <span key={cid} className="nv-cluster-pill">
            <span className="nv-dot" style={{ backgroundColor: colors[i % colors.length] }} />
            <span>C{cid}: {Math.round((count / total) * 100)}%</span>
          </span>
        ))}
        {noiseCount > 0 && (
          <span className="nv-cluster-pill nv-cluster-noise-pill">
            <span className="nv-dot noise" />
            <span>Noise {noisePct}%</span>
          </span>
        )}
      </div>
      <div className="nv-legend">
        <span>{k ? `K=${k} clusters` : "Clusters"}</span>
        <span>{total} rows</span>
      </div>
    </div>
  );
}

/** Permutation Feature Importance: ranked horizontal impact bars */
function FeatureImportanceVisual({ outputs }: { outputs: AttemptOutput[] }) {
  const importanceOutput = outputs.find((o) => o.port === "importance") ?? outputs.find((o) => o.artifact.media_type === PARQUET);
  const page = useTablePage(importanceOutput?.artifact.id, 0, 10);
  if (!page.data) return <VisualSkeleton />;

  const featIdx = page.data.columns.findIndex((c) => c.name === "feature");
  const impIdx = page.data.columns.findIndex((c) => c.name === "importance");

  if (featIdx === -1 || impIdx === -1) return <VisualSkeleton />;

  const rows = page.data.rows.slice(0, 3).map((r) => ({
    feature: String(r.values[featIdx] ?? ""),
    imp: Number(r.values[impIdx] ?? 0),
  }));

  const maxImp = Math.max(0.001, ...rows.map((r) => r.imp));

  return (
    <div className="nv nv-importance" aria-label={`feature importance, top feature ${rows[0]?.feature ?? ""}`}>
      <div className="nv-imp-list">
        {rows.map((r) => {
          const pct = Math.max(8, Math.min(100, (r.imp / maxImp) * 100));
          return (
            <div key={r.feature} className="nv-imp-row">
              <span className="nv-imp-name" title={r.feature}>{r.feature}</span>
              <div className="nv-imp-track">
                <span className="nv-imp-fill" style={{ width: `${pct}%` }} />
              </div>
              <span className="nv-imp-num">{r.imp.toFixed(3)}</span>
            </div>
          );
        })}
      </div>
      <div className="nv-legend">
        <span>feature impact</span>
        <span>top {rows.length}</span>
      </div>
    </div>
  );
}

/** Profile Distributions & Histograms: dual distribution shapes and correlation */
function DistributionsVisual({ outputs }: { outputs: AttemptOutput[] }) {
  const histOutput = outputs.find((o) => o.port === "histograms");
  const corrOutput = outputs.find((o) => o.port === "correlation");
  const page = useTablePage(histOutput?.artifact.id, 0, 100);
  const corrPage = useTablePage(corrOutput?.artifact.id, 0, 50);

  if (!page.data) return <VisualSkeleton />;

  const colIdx = page.data.columns.findIndex((c) => c.name === "column_name");
  const countIdx = page.data.columns.findIndex((c) => c.name === "count");

  if (colIdx === -1 || countIdx === -1) return <VisualSkeleton />;

  const cols = new Map<string, number[]>();
  for (const r of page.data.rows) {
    const colName = String(r.values[colIdx]);
    const cnt = Number(r.values[countIdx] ?? 0);
    if (!cols.has(colName)) cols.set(colName, []);
    cols.get(colName)!.push(cnt);
  }

  const entries = Array.from(cols.entries()).slice(0, 2);
  const topCorr = corrPage.data?.rows[0];
  const corrVal = topCorr ? Number(topCorr.values[2] ?? 0) : undefined;

  return (
    <div className="nv nv-distributions" aria-label="histograms and distributions">
      <div className="nv-dist-cols">
        {entries.map(([name, bins]) => {
          const maxBin = Math.max(1, ...bins);
          return (
            <div key={name} className="nv-dist-item">
              <span className="nv-dist-name" title={name}>{name}</span>
              <div className="nv-dist-bars">
                {bins.slice(0, 16).map((b, i) => (
                  <span
                    key={i}
                    style={{ height: `${Math.max(12, (b / maxBin) * 100)}%` }}
                    title={`Bin ${i + 1}: ${b}`}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <div className="nv-legend">
        <span>{cols.size} numeric dists</span>
        {corrVal !== undefined && !isNaN(corrVal) && (
          <span>max r: <b>{corrVal.toFixed(2)}</b></span>
        )}
      </div>
    </div>
  );
}

/** Outlier Treatment & Clipping: bell curve with shaded cutoff tails */
function ClipOutliersVisual({ params }: { params: Record<string, unknown> }) {
  const lower = typeof params.lower_quantile === "number" ? params.lower_quantile : 0.01;
  const upper = typeof params.upper_quantile === "number" ? params.upper_quantile : 0.99;
  const cols = Array.isArray(params.columns) ? params.columns.length : undefined;

  return (
    <div className="nv nv-clip" aria-label={`clipped outliers [${lower * 100}% - ${upper * 100}%]`}>
      <div className="nv-clip-curve">
        <svg viewBox="0 0 100 24" className="nv-spark" role="img" aria-label="Outlier clipping bell curve">
          <path d="M 0,22 Q 10,22 18,18 L 18,22 Z" fill="var(--alert)" opacity="0.45" />
          <path d="M 18,18 Q 35,4 50,4 Q 65,4 82,18 L 82,22 L 18,22 Z" fill="var(--soft)" opacity="0.15" />
          <path d="M 82,18 Q 90,22 100,22 L 82,22 Z" fill="var(--alert)" opacity="0.45" />
          <path d="M 0,22 Q 10,22 25,14 Q 50,2 75,14 Q 90,22 100,22" fill="none" stroke="var(--ink)" strokeWidth="1.2" />
          <line x1="18" y1="2" x2="18" y2="22" stroke="var(--alert)" strokeWidth="1" strokeDasharray="2,2" />
          <line x1="82" y1="2" x2="82" y2="22" stroke="var(--alert)" strokeWidth="1" strokeDasharray="2,2" />
        </svg>
      </div>
      <div className="nv-legend">
        <span>quantiles: <b>P{Math.round(lower * 100)}–P{Math.round(upper * 100)}</b></span>
        <span>{cols !== undefined ? `${cols} cols clipped` : "tails clipped"}</span>
      </div>
    </div>
  );
}

function SplitBar({ outputs, params }: { outputs: AttemptOutput[]; params?: Record<string, unknown> }) {
  const [a, b] = outputs as [AttemptOutput, AttemptOutput];
  const left = useTablePage(a.artifact.id, 0, 1).data?.total_rows;
  const right = useTablePage(b.artifact.id, 0, 1).data?.total_rows;
  if (left === undefined || right === undefined) return <VisualSkeleton />;

  // Show training data first, whichever order the ports arrived in.
  const [first, second, n1, n2] = a.port === "test" ? [b, a, right, left] : [a, b, left, right];
  const share = n1 + n2 === 0 ? 0 : n1 / (n1 + n2);
  const groupCol = typeof params?.group_column === "string" ? params.group_column : undefined;
  const timeCol = typeof params?.time_column === "string" ? params.time_column : undefined;

  return (
    <div className="nv nv-split" aria-label={`${first.port} ${n1} rows, ${second.port} ${n2} rows`}>
      <div className="nv-split-bar">
        <span style={{ width: `${share * 100}%` }} />
      </div>
      <div className="nv-legend">
        <span>
          {first.port} <b>{n1}</b>
        </span>
        <span>{Math.round(share * 100)} / {Math.round((1 - share) * 100)}</span>
        <span>
          {second.port} <b>{n2}</b>
        </span>
      </div>
      {(groupCol || timeCol) && (
        <div className="nv-subnote">
          {groupCol && <span>Grouped by <b>{groupCol}</b></span>}
          {timeCol && <span>Ordered by <b>{timeCol}</b></span>}
        </div>
      )}
    </div>
  );
}

function MissingBars({ artifactId }: { artifactId: string }) {
  const page = useTablePage(artifactId, 0, 200);
  if (!page.data) return <VisualSkeleton />;
  const at = page.data.columns.findIndex((c) => c.name === "null_percentage");
  const shares = page.data.rows.map((r) => Number(r.values[at] ?? 0));
  const worst = Math.max(0, ...shares);
  return (
    <div className="nv" aria-label={`missing values, worst column ${worst}%`}>
      <div className="nv-bars">
        {shares.map((v, i) => (
          <span key={i} className={v > 0 ? "warn" : undefined} style={{ height: `${Math.max(8, Math.min(100, v * 4))}%` }} />
        ))}
      </div>
      <div className="nv-legend">
        <span>missing by column</span>
        <span>{worst === 0 ? "all complete" : `max ${worst}%`}</span>
      </div>
    </div>
  );
}

function ColumnTypes({ artifactId }: { artifactId: string }) {
  const page = useTablePage(artifactId, 0, 1);
  if (!page.data) return <VisualSkeleton />;
  return <TypeChips page={page.data} />;
}

function TypeChips({ page }: { page: TablePage }) {
  const shown = page.columns.slice(0, 5);
  return (
    <div className="nv nv-cols">
      {shown.map((c) => (
        <span key={c.name} className="nv-col">
          <span className="nv-col-type">{typeGlyph(c.data_type)}</span>
          {c.name}
        </span>
      ))}
      {page.total_columns > shown.length && <span className="nv-more">+{page.total_columns - shown.length} more</span>}
    </div>
  );
}

const typeGlyph = (t: string) => (/Float|Int|Decimal/.test(t) ? "#" : /Utf8|String|Categorical|Dictionary/.test(t) ? "Aa" : /Date|Time/.test(t) ? "◷" : "·");

function MiniConfusion({ matrix }: { matrix: number[][] }) {
  if (!matrix || matrix.length < 2) return null;
  const flat = matrix.flat();
  const max = Math.max(1, ...flat);
  return (
    <div className="nv-confusion-grid" title="Confusion matrix (diagonal is correct)">
      {matrix.slice(0, 2).map((row, r) => (
        <div key={r} className="nv-conf-row">
          {row.slice(0, 2).map((val, c) => {
            const isDiag = r === c;
            const opacity = Math.max(0.2, val / max);
            return (
              <span
                key={c}
                className={`nv-conf-cell${isDiag ? " diag" : " off"}`}
                style={{
                  backgroundColor: isDiag
                    ? `rgba(126, 208, 138, ${opacity})`
                    : val > 0 ? `rgba(255, 92, 92, ${opacity})` : "var(--wash)",
                }}
                title={`r${r} c${c}: ${val}`}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}

function MetricTrend(props: VisualFor) {
  const outputs = useOutputs(props.attemptId);
  const text = useArtifactText(outputs.data?.find((o) => o.port === props.metricsPort)?.artifact.id);
  const metric = text.data === undefined ? undefined : headlineMetric(text.data);
  const trend = useNodeHistory(props.pipelineVersionId, props.nodeId)
    .map((h) => h.metrics?.[metric?.name ?? ""])
    .filter((v): v is number => v !== undefined)
    .reverse();

  if (!metric) return <VisualSkeleton />;

  let extraData: { confusion?: { matrix: number[][] }; r2?: number; rmse?: number; f1_macro?: number } | undefined;
  if (text.data) {
    try {
      extraData = JSON.parse(text.data);
    } catch {
      // not json
    }
  }

  const confusion = extraData?.confusion?.matrix;
  const secondaryMetric =
    metric.name === "accuracy" && typeof extraData?.f1_macro === "number"
      ? { name: "f1", value: extraData.f1_macro }
      : metric.name === "rmse" && typeof extraData?.r2 === "number"
        ? { name: "r2", value: extraData.r2 }
        : undefined;

  return (
    <div className="nv nv-metric">
      <div className="nv-metric-value">
        <b>{formatMetric(metric.value)}</b>
        <span>{metric.name}</span>
        {secondaryMetric && (
          <span className="nv-subnote">
            {secondaryMetric.name}: <b>{formatMetric(secondaryMetric.value)}</b>
          </span>
        )}
      </div>
      <div className="nv-metric-extra">
        {confusion && <MiniConfusion matrix={confusion} />}
        <Sparkline values={trend} label={`${metric.name} over the last ${trend.length} runs`} />
      </div>
    </div>
  );
}

function Sparkline({ values, label }: { values: number[]; label: string }) {
  if (values.length < 2) return <p className="nv-note">trend after 2 runs</p>;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const points = values.map((v, i) => [4 + (i / (values.length - 1)) * 92, 22 - ((v - lo) / span) * 18] as const);
  const last = points.at(-1) ?? [0, 0];
  return (
    <svg className="nv-spark" viewBox="0 0 100 26" role="img" aria-label={label}>
      <polyline points={points.map((p) => p.join(",")).join(" ")} />
      <circle cx={last[0]} cy={last[1]} r="2.2" />
    </svg>
  );
}

function ModelSummary({ params }: { params: Record<string, unknown> }) {
  const features = Array.isArray(params.features) ? params.features.length : undefined;
  const rows: [string, string][] = [];
  if (typeof params.target === "string") rows.push(["target", params.target]);
  if (features !== undefined) rows.push(["features", String(features)]);
  if (typeof params.task === "string") rows.push(["task", params.task]);
  return (
    <dl className="nv nv-kv">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function CodeThumb({ outputs }: { outputs: AttemptOutput[] }) {
  const display = outputs.find((o) => o.port === "display")?.artifact;
  const small = display !== undefined && display.size_bytes <= MAX_THUMB_SOURCE_BYTES;
  const text = useArtifactText(small ? display.id : undefined);
  if (!small) return <p className="nv-note">output in the Inspector</p>;
  if (text.data === undefined) return <VisualSkeleton />;
  let items;
  try {
    items = parse("CodeDisplay", JSON.parse(text.data)).items;
  } catch {
    return <p className="nv-note">output in the Inspector</p>; // the Inspector shows why
  }
  const figure = items.find((i) => i.kind === "figure" && i.figure)?.figure;
  if (figure) return <span className="card-figure"><FigureView figure={figure} index={0} small /></span>;
  const image = items.find((i) => i.kind === "image" && i.png_base64);
  if (image) return <img className="nv-thumb" alt="first figure" src={`data:image/png;base64,${image.png_base64 ?? ""}`} />;
  const table = items.find((i) => i.kind === "table")?.table;
  if (table) return <TypeChips page={table} />;
  const firstLine = items.find((i) => i.kind === "text")?.text?.split("\n")[0];
  return <p className="nv-note mono">{firstLine ?? "no output"}</p>;
}

function VisualSkeleton() {
  return <div className="nv nv-skeleton" aria-hidden="true" />;
}

