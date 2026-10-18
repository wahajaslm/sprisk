import type { CodeSplit, NodeSource, NotebookCell, PipelineVersion, SplitParameter } from "@sprisk/contracts";
import { ulid } from "ulid";

import { nextVersion, timestamp } from "../flow/edit.ts";
import { isNotebookStep, NOTEBOOK_OPERATOR } from "../flow/notebook.ts";
import type { Ran } from "./outputs.ts";

const NODE_ID = /^[a-z][a-z0-9_]{0,62}$/;

/** What the picked cells need and make, read by Python (ADR-0036). The person confirms it. */
export type Proposal = { source: string; inputs: string[]; parameters: SplitParameter[]; outputs: string[]; notes: string[] };

/** An input and the port of the flow that will give it to the node. */
export type Link = { name: string; from: string };

/** The node the picked code cells `first..last` make, from Python's split with them kept
 * together. `cellNumber` turns a code cell's index into the number the person sees. */
export function proposeNode(split: CodeSplit, first: number, last: number, cellNumber: (index: number) => number): { proposal: Proposal } | { refused: string } {
  const step = split.steps.find((s) => s.cells.some((c) => c >= first && c <= last));
  if (!step) return { refused: "The picked cells only import or define nothing to run." };
  const outside = step.cells.find((c) => c < first || c > last);
  if (outside !== undefined) {
    const why = split.notes.find((n) => step.cells.includes(n.cell))?.message;
    return { refused: `Cell ${cellNumber(outside)} must be in this node too${why ? `: ${why}` : ""}. Pick it as well.` };
  }
  const notes = split.notes.filter((n) => step.cells.includes(n.cell)).map((n) => n.message);
  return { proposal: { source: step.source, inputs: step.inputs, parameters: step.parameters, outputs: step.outputs, notes } };
}

/** Each input linked to the one notebook-made step of the flow that makes it. Never a built-in
 * step's port by a look-alike name (`split_test` could be a holdout), and never a guess
 * between two steps that make the same name. */
export function bindInputs(base: PipelineVersion | undefined, inputs: string[]): { links: Link[] } | { refused: string } {
  const links: Link[] = [];
  for (const name of inputs) {
    const makers = (base?.nodes ?? []).filter((n) => isNotebookStep(n.operator) && namesOf(n.params["outputs"]).includes(name));
    if (makers.length === 0) return { refused: `No step in this flow makes ${name}. Pick the cells that make it too, or create their node first.` };
    if (makers.length > 1) {
      const ids = makers.map((n) => n.id);
      return { refused: `Steps ${ids.slice(0, -1).join(", ")} and ${ids.at(-1)} both make ${name}. Rename one, or pick the cells that make it too.` };
    }
    links.push({ name, from: `${makers[0]!.id}.${name}` });
  }
  return { links };
}

const namesOf = (value: unknown) => (Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []);

/** Why the node may not do what the session showed: picked cells that never ran, changed
 * since they ran, or a notebook run out of order. The analyzer assists; the person decides. */
export function sessionWarnings(cells: NotebookCell[], first: number, last: number, ran: Record<string, Ran>, cellNumber: (index: number) => number): string[] {
  const warnings = cells.flatMap((cell, i) => {
    if (i < first || i > last || cell.kind !== "code") return [];
    const run = ran[cell.id];
    if (!run) return [`Cell ${cellNumber(i)} has not run in this session.`];
    return run.code === cell.source ? [] : [`Cell ${cellNumber(i)} changed since it ran.`];
  });
  if (ranOutOfOrder(cells, ran)) warnings.push("Cells ran out of order: the session's values may come from cells below the ones they read.");
  return warnings;
}

/** True when a cell lower down ran before one above it. */
export function ranOutOfOrder(cells: NotebookCell[], ran: Record<string, Ran>) {
  const counts = cells.flatMap((c) => {
    const n = ran[c.id]?.result.execution_count;
    return n === undefined ? [] : [n];
  });
  return counts.some((n, i) => i > 0 && n < counts[i - 1]!);
}

type AddNode = {
  base: PipelineVersion | undefined;
  projectId: string;
  proposal: Proposal;
  nodeId: string;
  /** The proposed outputs the person kept. */
  outputs: string[];
  /** The proposed parameters the person exposed as settings. */
  parameters: string[];
  from: NodeSource;
};

/** The flow with the confirmed node added, each input linked to the step that makes it. With
 * no flow yet, a new one. */
export function addNode({ base, projectId, proposal, nodeId, outputs, parameters, from }: AddNode): { version: PipelineVersion } | { refused: string } {
  if (!NODE_ID.test(nodeId)) return { refused: `${nodeId} is not a step name: use lowercase letters, digits and _, starting with a letter.` };
  if (base?.nodes.some((n) => n.id === nodeId)) return { refused: `This flow already has a step named ${nodeId}.` };
  const bound = bindInputs(base, proposal.inputs);
  if ("refused" in bound) return bound;
  const edges = bound.links.map((l) => ({ from: l.from, to: `${nodeId}.${l.name}` }));
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
