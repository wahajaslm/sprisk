import type { PipelineVersion } from "@sprisk/contracts";
import { ulid } from "ulid";

export const CODE_OPERATOR = "sprisk.code.python@1.0.0";

const STARTER = `# \`data\` is the input table as a polars DataFrame (\`pl\` is polars).
# Printed text, the last line's value and matplotlib figures are shown.
data.describe()
`;

/** Versions are immutable: every edit is a new version with a fresh id (rule 5). */
function nextVersion(base: PipelineVersion, change: Pick<PipelineVersion, "nodes" | "edges">): PipelineVersion {
  return {
    ...base,
    ...change,
    id: `plv_${ulid()}`,
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

export function setCodeSource(base: PipelineVersion, nodeId: string, source: string): PipelineVersion {
  return nextVersion(base, {
    nodes: base.nodes.map((n) => (n.id === nodeId ? { ...n, params: { source } } : n)),
    edges: base.edges,
  });
}
