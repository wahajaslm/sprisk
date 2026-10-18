import type { CodeSplit, NodeSource, Operator, PipelineVersion, SplitParameter } from "@sprisk/contracts";
import { ulid } from "ulid";

import { nextVersion, timestamp } from "../flow/edit.ts";
import { NOTEBOOK_OPERATOR } from "../flow/notebook.ts";

const NODE_ID = /^[a-z][a-z0-9_]{0,62}$/;

/** What the picked cells need and make, read by Python (ADR-0036). The person confirms it. */
export type Proposal = { source: string; inputs: string[]; parameters: SplitParameter[]; outputs: string[] };

/** The node the picked code cells `first..last` make, from Python's split with them kept
 * together. `cellNumber` turns a code cell's index into the number the person sees. */
export function proposeNode(
  split: CodeSplit,
  first: number,
  last: number,
  cellNumber: (index: number) => number = (i) => i + 1,
): { proposal: Proposal } | { refused: string } {
  const step = split.steps.find((s) => s.cells.some((c) => c >= first && c <= last));
  if (!step) return { refused: "The picked cells only import or define nothing to run." };
  const outside = step.cells.find((c) => c < first || c > last);
  if (outside !== undefined) {
    const why = split.notes.find((n) => step.cells.includes(n.cell))?.message;
    return { refused: `Cell ${cellNumber(outside)} must be in this node too${why ? `: ${why}` : ""}. Pick it as well.` };
  }
  return { proposal: { source: step.source, inputs: step.inputs, parameters: step.parameters, outputs: step.outputs } };
}

type AddNode = {
  base: PipelineVersion | undefined;
  projectId: string;
  operators: Map<string, Operator>;
  proposal: Proposal;
  nodeId: string;
  /** The proposed outputs the person kept. */
  outputs: string[];
  /** The proposed parameters the person exposed as settings. */
  parameters: string[];
  from: NodeSource;
};

/** The flow with the confirmed node added, each input linked to the step that makes it by
 * name, as notebook cells link (ADR-0031). With no flow yet, a new one. */
export function addNode({ base, projectId, operators, proposal, nodeId, outputs, parameters, from }: AddNode): { version: PipelineVersion } | { refused: string } {
  if (!NODE_ID.test(nodeId)) return { refused: `${nodeId} is not a step name: use lowercase letters, digits and _, starting with a letter.` };
  if (base?.nodes.some((n) => n.id === nodeId)) return { refused: `This flow already has a step named ${nodeId}.` };
  const edges = [];
  for (const name of proposal.inputs) {
    const maker = base ? makerOf(base, operators, name) : undefined;
    if (!maker) return { refused: `No step in this flow makes ${name}. Pick the cells that make it too, or create their node first.` };
    edges.push({ from: maker, to: `${nodeId}.${name}` });
  }
  const exposed = proposal.parameters.filter((p) => parameters.includes(p.name));
  const node = {
    id: nodeId,
    operator: NOTEBOOK_OPERATOR,
    params: {
      source: proposal.source,
      inputs: proposal.inputs,
      outputs: proposal.outputs.filter((o) => outputs.includes(o)),
      ...(exposed.length > 0 ? { parameters: Object.fromEntries(exposed.map((p) => [p.name, p.value])) } : {}),
    },
    from_notebook: from,
  };
  if (!base) {
    const version: PipelineVersion = { schema_version: "sprisk.pipeline_version/v1", id: `plv_${ulid()}`, project_id: projectId, nodes: [node], edges, created_at: timestamp() };
    return { version };
  }
  return { version: nextVersion(base, { nodes: [...base.nodes, node], edges: [...base.edges, ...edges] }) };
}

/** The port that makes `name`: a notebook step's output of that name, or a built-in step's
 * output written `<step>_<port>`, as the notebook names them (ADR-0033). */
function makerOf(base: PipelineVersion, operators: Map<string, Operator>, name: string): string | undefined {
  for (const node of base.nodes) {
    const outputs = node.params["outputs"];
    if (node.operator.startsWith("sprisk.code.python@2.") && Array.isArray(outputs) && outputs.includes(name)) return `${node.id}.${name}`;
    const port = operators.get(node.operator)?.outputs.find((o) => `${node.id}_${o.name}` === name);
    if (port) return `${node.id}.${port.name}`;
  }
  return undefined;
}
