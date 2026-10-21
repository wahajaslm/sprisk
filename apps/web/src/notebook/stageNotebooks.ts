import type { Node, Operator, PipelineVersion } from "@sprisk/contracts";

import { isCodeOperator } from "../flow/edit.ts";
import { namedPorts, notebookOrder } from "../flow/notebook.ts";
import { portOf, stepOf } from "../flow/ports.ts";
import { type Stage, STAGES, stageOf } from "../flow/stages.ts";

type Operators = Map<string, Operator>;

const STAGE_OF_NODE: Record<NonNullable<Node["stage"]>, Stage> = {
  explore: "Explore",
  split: "Split",
  clean: "Clean",
  model: "Model",
  evaluate: "Evaluate",
};

/** The flow as one notebook per stage, in stage order, each step after the steps it reads.
 * A step is in its own stage when it keeps one (ADR-0055). Otherwise it is in the stage its
 * operator implies, but never before a stage it reads from: a chart of cleaned rows is Clean. */
export function stageNotebooks(pipeline: PipelineVersion, operators: Operators): { stage: Stage; nodes: Node[] }[] {
  const order = notebookOrder(pipeline);
  const placed = new Map<string, Stage>();
  for (const node of order) {
    if (node.stage) {
      placed.set(node.id, STAGE_OF_NODE[node.stage]);
      continue;
    }
    const operator = operators.get(node.operator);
    const read = pipeline.edges.filter((e) => stepOf(e.to) === node.id).map((e) => placed.get(stepOf(e.from)) ?? "Explore");
    placed.set(node.id, latest([operator ? stageOf(operator) : "Explore", ...read]));
  }
  return STAGES.map((stage) => ({ stage, nodes: order.filter((n) => placed.get(n.id) === stage) })).filter((s) => s.nodes.length > 0);
}

const latest = (stages: Stage[]): Stage => stages.reduce((a, b) => (STAGES.indexOf(b) > STAGES.indexOf(a) ? b : a));

/** Output ports a cell gives on; diagnostics (a code step's display and interface) are not names. */
function outputPorts(node: Node, operators: Operators): string[] {
  const operator = operators.get(node.operator);
  const declared = (operator?.outputs ?? []).filter((o) => o.kind !== "diagnostics").map((o) => String(o.name));
  return [...declared, ...namedPorts(operator, node.params, "output")];
}

/** The variable an output goes by: a code step's own name, the step's kept name, the port name
 * when no other step gives it, else `<step>_<port>`. */
function variableOf(pipeline: PipelineVersion, operators: Operators, nodeId: string, port: string): string {
  const node = pipeline.nodes.find((n) => n.id === nodeId);
  if (!node || isCodeOperator(node.operator)) return port;
  const kept = node.names?.[port];
  if (kept) return kept;
  const shared = pipeline.nodes.some((n) => n.id !== nodeId && outputPorts(n, operators).includes(port));
  return shared ? `${nodeId}_${port}` : port;
}

/** The names a step's cell reads from cells above and gives to cells below. */
export function stepNames(pipeline: PipelineVersion, operators: Operators, nodeId: string): { reads: string[]; gives: string[] } {
  const node = pipeline.nodes.find((n) => n.id === nodeId);
  if (!node) throw new Error(`flow ${pipeline.id} has no step ${nodeId}`);
  const into = pipeline.edges.filter((e) => stepOf(e.to) === nodeId);
  const reads = isCodeOperator(node.operator) ? into.map((e) => portOf(e.to)) : into.map((e) => variableOf(pipeline, operators, stepOf(e.from), portOf(e.from)));
  const gives = outputPorts(node, operators).map((port) => variableOf(pipeline, operators, nodeId, port));
  return { reads: [...new Set(reads)], gives };
}
