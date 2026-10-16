import type { NodeCode, PipelineVersion } from "@sprisk/contracts";
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

/** A new version where a step runs its own code, or (undefined) its operator's again
 * (ADR-0028). */
export function setNodeCode(base: PipelineVersion, nodeId: string, code: NodeCode | undefined): PipelineVersion {
  return nextVersion(base, {
    nodes: base.nodes.map((n) => {
      if (n.id !== nodeId) return n;
      const { code: _old, ...rest } = n;
      return code ? { ...rest, code } : rest;
    }),
    edges: base.edges,
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
