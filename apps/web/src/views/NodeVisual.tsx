import type { AttemptOutput, TablePage } from "@sprisk/contracts";
import { parse } from "@sprisk/contracts";

import { useArtifactText, useOutputs, useTablePage } from "../api/hooks.ts";
import { PARQUET } from "../api/media.ts";
import { useMetricTrend } from "../api/trend.ts";
import { isCodeOperator } from "../flow/edit.ts";
import { isProfileOperator } from "../flow/stages.ts";
import { formatMetric, headlineMetric } from "./NodeFact.tsx";

/** Thumbnails are only read when small; bigger figures stay in the Inspector. */
const MAX_THUMB_SOURCE_BYTES = 1024 * 1024;

export type VisualFor = {
  attemptId: string;
  operator: string;
  capability: string;
  params: Record<string, unknown>;
  pipelineVersionId: string | undefined;
  nodeId: string;
};

/** A small picture of a step's main output, chosen from what the step produced. */
export function NodeVisual(props: VisualFor) {
  const outputs = useOutputs(props.attemptId);
  const all = outputs.data ?? [];
  const tables = all.filter((o) => o.artifact.media_type === PARQUET);
  if (isCodeOperator(props.operator)) return <CodeThumb outputs={all} />;
  if (isProfileOperator(props.operator) && tables[0]) return <MissingBars artifactId={tables[0].artifact.id} />;
  if (props.capability === "evaluator") return <MetricTrend {...props} />;
  if (props.capability === "estimator") return <ModelSummary params={props.params} />;
  if (tables.length >= 2) return <SplitBar outputs={tables} />;
  if (tables[0]) return <ColumnTypes artifactId={tables[0].artifact.id} />;
  return null;
}

function SplitBar({ outputs }: { outputs: AttemptOutput[] }) {
  const [a, b] = outputs as [AttemptOutput, AttemptOutput];
  const left = useTablePage(a.artifact.id, 0, 1).data?.total_rows;
  const right = useTablePage(b.artifact.id, 0, 1).data?.total_rows;
  if (left === undefined || right === undefined) return <VisualSkeleton />;
  // Show training data first, whichever order the ports arrived in.
  const [first, second, n1, n2] = a.port === "test" ? [b, a, right, left] : [a, b, left, right];
  const share = n1 + n2 === 0 ? 0 : n1 / (n1 + n2);
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
        <span>{worst === 0 ? "none" : `max ${worst}%`}</span>
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

function MetricTrend(props: VisualFor) {
  const outputs = useOutputs(props.attemptId);
  const text = useArtifactText(outputs.data?.[0]?.artifact.id);
  const metric = text.data === undefined ? undefined : headlineMetric(text.data);
  const trend = useMetricTrend(props.pipelineVersionId, props.nodeId);
  if (!metric) return <VisualSkeleton />;
  return (
    <div className="nv nv-metric">
      <div className="nv-metric-value">
        <b>{formatMetric(metric.value)}</b>
        <span>{metric.name}</span>
      </div>
      <Sparkline values={trend} label={`${metric.name} over the last ${trend.length} runs`} />
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
