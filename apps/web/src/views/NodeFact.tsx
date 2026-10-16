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
  isEvaluator,
  status,
}: FactProps & { attemptId: string; operator: string; isEvaluator: boolean }) {
  const outputs = useOutputs(attemptId);
  const first = outputs.data?.[0]?.artifact;
  if (first?.media_type === PARQUET) {
    const many = (outputs.data?.length ?? 0) > 1;
    const size = isProfileOperator(operator)
      ? (rows: number) => `${rows} cols profiled`
      : many
        ? (rows: number, cols: number) => `${outputs.data?.[0]?.port ?? ""} ${rows} × ${cols}`
        : (rows: number, cols: number) => `${rows} rows × ${cols} cols`;
    return <TableSize artifactId={first.id} status={status} size={size} />;
  }
  if (isEvaluator && first?.media_type === "application/json" && first.size_bytes <= MAX_INLINE_BYTES) {
    return <Headline artifactId={first.id} status={status} />;
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

function headline(text: string): string | undefined {
  let metrics: unknown;
  try {
    metrics = JSON.parse(text);
  } catch {
    return undefined; // the node keeps its status; the Inspector shows the raw text
  }
  if (typeof metrics !== "object" || metrics === null) return undefined;
  const values = metrics as Record<string, unknown>;
  const name = HEADLINE_METRICS.find((m) => typeof values[m] === "number");
  return name ? `${name} ${Number((values[name] as number).toPrecision(3))}` : undefined;
}
