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

/** A step's stage: its own when it keeps one (ADR-0055), else the one its operator implies. */
export function stageOfNode(node: Node, operators: Operators): Stage {
  if (node.stage) return STAGE_OF_NODE[node.stage];
  const operator = operators.get(node.operator);
  return operator ? stageOf(operator) : "Explore";
}

/** The flow as one notebook per stage, in stage order, each step after the steps it reads. */
export function stageNotebooks(pipeline: PipelineVersion, operators: Operators): { stage: Stage; nodes: Node[] }[] {
  const order = notebookOrder(pipeline);
  return STAGES.map((stage) => ({ stage, nodes: order.filter((n) => stageOfNode(n, operators) === stage) })).filter((s) => s.nodes.length > 0);
}

/** Output ports a cell gives on; diagnostics (a code step's display and interface) are not names. */
function outputPorts(node: Node, operators: Operators): string[] {
  const operator = operators.get(node.operator);
  if (isCodeOperator(node.operator)) return namedPorts(operator, node.params, "output");
  return (operator?.outputs ?? []).filter((o) => o.kind !== "diagnostics").map((o) => String(o.name));
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
