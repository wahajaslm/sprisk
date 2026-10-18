import type { ReactNode } from "react";

import { useArtifactText, useOutputs, useTablePage } from "../api/hooks.ts";
import { MAX_INLINE_BYTES, PARQUET } from "../api/media.ts";
import { isProfileOperator } from "../flow/stages.ts";

/** Shown in this order when an evaluator's metrics hold several. */
const HEADLINE_METRICS = ["accuracy", "r2", "rmse", "mae"];

type FactProps = { status: string };

/** One short fact about a succeeded step's first output, for the canvas node. Falls back to
 * the plain status while loading or when there is no fact to show. */
export function NodeFact({
  attemptId,
  operator,
  metricsPort,
  status,
}: FactProps & { attemptId: string; operator: string; metricsPort: string | undefined }) {
  const outputs = useOutputs(attemptId);
  const first = outputs.data?.[0]?.artifact;
  // Outputs are listed by port name, so an evaluator's metrics are found by port, not position.
  const metrics = metricsPort ? outputs.data?.find((o) => o.port === metricsPort)?.artifact : undefined;
  if (first?.media_type === PARQUET) {
    const many = (outputs.data?.length ?? 0) > 1;
    const size = isProfileOperator(operator)
      ? (rows: number) => `${rows} cols profiled`
      : many
        ? (rows: number, cols: number) => `${outputs.data?.[0]?.port ?? ""} ${rows} × ${cols}`
        : (rows: number, cols: number) => `${rows} rows × ${cols} cols`;
    return <TableSize artifactId={first.id} status={status} size={size} />;
  }
  if (metrics?.media_type === "application/json" && metrics.size_bytes <= MAX_INLINE_BYTES) {
    return <Headline artifactId={metrics.id} status={status} />;
  }
  return <>{status}</>;
}

type SizeText = (rows: number, cols: number) => string;

function TableSize({ artifactId, status, size }: FactProps & { artifactId: string; size: SizeText }) {
  const page = useTablePage(artifactId, 0, 1);
  return withStatus(status, page.data && size(page.data.total_rows, page.data.total_columns));
}

function Headline({ artifactId, status }: FactProps & { artifactId: string }) {
  const text = useArtifactText(artifactId);
  return withStatus(status, text.data === undefined ? undefined : headline(text.data));
}

function withStatus(status: string, fact: string | undefined): ReactNode {
  if (!fact) return <>{status}</>;
  return (
    <>
      <span className="sr-only">{status} · </span>
      <span className="node-fact">{fact}</span>
    </>
  );
}

/** The evaluator's headline metric, e.g. `{ name: "accuracy", value: 0.947 }`. */
export function headlineMetric(text: string): { name: string; value: number } | undefined {
  let metrics: unknown;
  try {
    metrics = JSON.parse(text);
  } catch {
    return undefined; // not metrics; the Inspector shows the raw text
  }
  if (typeof metrics !== "object" || metrics === null) return undefined;
  const values = metrics as Record<string, unknown>;
  const name = HEADLINE_METRICS.find((m) => typeof values[m] === "number");
  return name ? { name, value: values[name] as number } : undefined;
}

export const formatMetric = (value: number) => String(Number(value.toPrecision(3)));

function headline(text: string): string | undefined {
  const metric = headlineMetric(text);
  return metric && `${metric.name} ${formatMetric(metric.value)}`;
}

