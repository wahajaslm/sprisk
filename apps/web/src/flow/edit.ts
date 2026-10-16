import type { PipelineVersion } from "@sprisk/contracts";
import { ulid } from "ulid";

export const CODE_OPERATOR = "sprisk.code.python@1.2.0";
export const isCodeOperator = (ref: string | undefined) => ref?.startsWith("sprisk.code.python@") === true;

const STARTER = `# \`data\` is the input table as a polars DataFrame (\`pl\` is polars).
# Printed text, the last line's value and matplotlib figures are shown.
# sprisk.output(df) passes a table on to the next step (otherwise \`data\` passes on unchanged).
data.describe()
`;

/** Versions are immutable: every edit is a new version with a fresh id (rule 5). */
function nextVersion(base: PipelineVersion, change: Pick<PipelineVersion, "nodes" | "edges">): PipelineVersion {
  return {
    ...base,
    ...change,
    id: `plv_${ulid()}`,
    parent_id: base.id,
    created_at: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
  };
}

/** A code step reading `node.port` (ADR-0020). */
export function addCodeStep(base: PipelineVersion, node: string, port: string) {
  let n = 1;
  while (base.nodes.some((x) => x.id === `code_${n}`)) n += 1;
  const nodeId = `code_${n}`;
  const version = nextVersion(base, {
    nodes: [...base.nodes, { id: nodeId, operator: CODE_OPERATOR, params: { source: STARTER } }],
    edges: [...base.edges, { from: `${node}.${port}`, to: `${nodeId}.data` }],
  });
  return { version, nodeId };
}

export const CHART_OPERATOR = "sprisk.profile.chart@1.0.0";
export const CHART_KINDS = ["histogram", "box", "scatter", "bar", "line"] as const;
export type ChartSpec = { kind: (typeof CHART_KINDS)[number]; x: string; y?: string };

export const isChartOperator = (ref: string | undefined) => ref?.startsWith("sprisk.profile.chart@") === true;

/** A new version with a chart step reading `node.port` (ADR-0023). */
export function addChartStep(base: PipelineVersion, node: string, port: string, spec: ChartSpec) {
  let n = 1;
  while (base.nodes.some((x) => x.id === `chart_${n}`)) n += 1;
  const nodeId = `chart_${n}`;
  const version = nextVersion(base, {
    nodes: [...base.nodes, { id: nodeId, operator: CHART_OPERATOR, params: { ...spec } }],
    edges: [...base.edges, { from: `${node}.${port}`, to: `${nodeId}.data` }],
  });
  return { version, nodeId };
}

/** Chart steps that draw this step's tables. They are views of it: shown in its
 * Visualizations, never as canvas steps. */
export const chartsOf = (pipeline: PipelineVersion, nodeId: string) =>
  pipeline.nodes.filter(
    (n) => isChartOperator(n.operator) && pipeline.edges.some((e) => e.to === `${n.id}.data` && e.from.split(".")[0] === nodeId),
  );

/** The flow as the canvas draws it: chart steps left out (they live inside their step). */
export function withoutCharts(pipeline: PipelineVersion): PipelineVersion {
  const charts = new Set(pipeline.nodes.filter((n) => isChartOperator(n.operator)).map((n) => n.id));
  return {
    ...pipeline,
    nodes: pipeline.nodes.filter((n) => !charts.has(n.id)),
    edges: pipeline.edges.filter((e) => !charts.has(e.to.split(".")[0] ?? "")),
  };
}

/** A new version without this step and the edges into it. Only for steps nothing reads. */
export function removeStep(base: PipelineVersion, nodeId: string): PipelineVersion {
  return nextVersion(base, {
    nodes: base.nodes.filter((n) => n.id !== nodeId),
    edges: base.edges.filter((e) => e.to.split(".")[0] !== nodeId),
  });
}

/** A new version where one step runs with `params`; everything else is unchanged. */
export function setParams(base: PipelineVersion, nodeId: string, params: Record<string, unknown>): PipelineVersion {
  return nextVersion(base, {
    nodes: base.nodes.map((n) => (n.id === nodeId ? { ...n, params } : n)),
    edges: base.edges,
  });
}

/** New source for a code step, keeping its exposed settings and chosen output. */
export function setCodeSource(base: PipelineVersion, nodeId: string, source: string): PipelineVersion {
  const params = base.nodes.find((n) => n.id === nodeId)?.params ?? {};
  return setParams(base, nodeId, { ...params, source });
}
