import type { Node, Operator, PipelineVersion } from "@sprisk/contracts";

import { isCodeOperator } from "../flow/edit.ts";
import { namedPorts, nodeOf, notebookOrder, outputName } from "../flow/notebook.ts";
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
 * A step is in the stage it keeps (ADR-0055), else the one its operator implies, but never
 * before a stage it reads from: a chart of cleaned rows is Clean. */
export function stageNotebooks(pipeline: PipelineVersion, operators: Operators): { stage: Stage; nodes: Node[] }[] {
  const order = notebookOrder(pipeline);
  const placed = new Map<string, Stage>();
  for (const node of order) {
    const operator = operators.get(node.operator);
    const own = node.stage ? STAGE_OF_NODE[node.stage] : operator ? stageOf(operator) : "Explore";
    const read = pipeline.edges.filter((e) => stepOf(e.to) === node.id).map((e) => placed.get(stepOf(e.from)) ?? "Explore");
    placed.set(node.id, latest([own, ...read]));
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

/** The names a step's cell reads from cells above and gives to cells below. */
export function stepNames(pipeline: PipelineVersion, operators: Operators, nodeId: string): { reads: string[]; gives: string[] } {
  const node = nodeOf(pipeline, nodeId);
  const into = pipeline.edges.filter((e) => stepOf(e.to) === nodeId);
  const reads = isCodeOperator(node.operator) ? into.map((e) => portOf(e.to)) : into.map((e) => outputName(pipeline, e.from));
  const gives = outputPorts(node, operators).map((port) => outputName(pipeline, `${nodeId}.${port}`));
  return { reads: [...new Set(reads)], gives };
}
