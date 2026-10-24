import type { Node, Operator, PipelineVersion } from "@sprisk/contracts";

import { isCodeOperator } from "../flow/edit.ts";
import { namedPorts, nodeOf, notebookOrder, outputName } from "../flow/notebook.ts";
import { portOf, stepOf } from "../flow/ports.ts";
import { type Stage, STAGES, stageOf } from "../flow/stages.ts";

type Operators = Map<string, Operator>;

const STAGE_OF_NODE: Record<NonNullable<Node["stage"]>, Stage> = {
  load: "Load",
  split: "Split",
  explore: "Explore",
  clean: "Clean",
  model: "Model",
  evaluate: "Evaluate",
};

/** Each step's stage (ADR-0055): the one it keeps, else the one its operator implies, but
 * never before a stage it reads from. A look at the data (an analyzer or code) is in Load while
 * it reads only loaded rows, and in Explore once it reads the split's training rows. */
export function stagesOf(pipeline: PipelineVersion, operators: Operators): Map<string, Stage> {
  const placed = new Map<string, Stage>();
  for (const node of notebookOrder(pipeline)) {
    const operator = operators.get(node.operator);
    const read = pipeline.edges.filter((e) => stepOf(e.to) === node.id).map((e) => placed.get(stepOf(e.from)) ?? "Load");
    const own = node.stage ? STAGE_OF_NODE[node.stage] : operator ? stageOf(operator) : "Explore";
    const looksAtLoaded = own === "Explore" && !node.stage && read.every((s) => s === "Load");
    placed.set(node.id, looksAtLoaded ? "Load" : latest([own, ...read]));
  }
  return placed;
}

/** The flow as one notebook per stage, in stage order, each step after the steps it reads. */
export function stageNotebooks(pipeline: PipelineVersion, operators: Operators): { stage: Stage; nodes: Node[] }[] {
  const placed = stagesOf(pipeline, operators);
  const order = notebookOrder(pipeline);
  return STAGES.map((stage) => ({ stage, nodes: order.filter((n) => placed.get(n.id) === stage) })).filter((s) => s.nodes.length > 0);
}

/** Heading groups on the canvas, one per stage, placed as the notebooks are. Keys look like
 * "Clean#clean"; the part before "#" is the stage shown. */
export function stageGroups(pipeline: PipelineVersion, operators: Operators): Map<string, string> {
  return new Map([...stagesOf(pipeline, operators)].map(([id, stage]) => [id, `${stage}#${stage.toLowerCase()}`]));
}

const latest = (stages: Stage[]): Stage => stages.reduce((a, b) => (STAGES.indexOf(b) > STAGES.indexOf(a) ? b : a));

/** Output ports a cell gives on; diagnostics (a code step's display and interface) are not names. */
function outputPorts(node: Node, operators: Operators): string[] {
  const operator = operators.get(node.operator);
  const declared = (operator?.outputs ?? []).filter((o) => o.kind !== "diagnostics").map((o) => String(o.name));
  return [...declared, ...namedPorts(operator, node.params, "output")];
}
