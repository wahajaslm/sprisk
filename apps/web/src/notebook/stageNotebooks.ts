import type { FlowDecision, Node, Operator, PipelineVersion } from "@sprisk/contracts";

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

/** One notebook section: a stage, or the activity of the decisions that shaped its steps.
 * `home` is the stage a cell added to it takes: its own, or its first step's. */
export type Section = { name: string; home: Stage; nodes: Node[]; decisions: FlowDecision[] };

/** The flow as one notebook per section, in working order, each step after the steps it reads.
 * The steps a decision shaped sit under its activity (ADR-0063), placed where the earliest of
 * them would sit by stage; every other step keeps its stage. */
export function stageNotebooks(pipeline: PipelineVersion, operators: Operators, decisions: FlowDecision[] = []): Section[] {
  const placed = stagesOf(pipeline, operators);
  const order = notebookOrder(pipeline);
  const activityOf = new Map<string, FlowDecision>();
  for (const decision of decisions) {
    for (const step of decision.steps) if (!activityOf.has(step)) activityOf.set(step, decision);
  }
  const sections = new Map<string, Section & { at: number }>();
  for (const node of order) {
    const stage = placed.get(node.id) ?? "Unknown";
    const decision = activityOf.get(node.id);
    const name = decision?.activity ?? stage;
    // Decisions that share an activity share its section; an activity named like a stage does not.
    const key = decision ? `activity:${name}` : `stage:${name}`;
    // A stage comes before an activity that starts in it: Load, then what was measured on it.
    const at = STAGES.indexOf(stage) * 2 + (decision ? 1 : 0);
    const section = sections.get(key) ?? { name, home: stage, nodes: [], decisions: [], at };
    section.nodes.push(node);
    section.at = Math.min(section.at, at);
    if (decision && !section.decisions.includes(decision)) section.decisions.push(decision);
    sections.set(key, section);
  }
  return [...sections.values()].sort((a, b) => a.at - b.at).map(({ at: _at, ...section }) => section);
}

/** Heading groups on the canvas, one per section, placed as the notebooks are. Keys look like
 * "Clean#clean"; the part before "#" is the name shown. */
export function stageGroups(pipeline: PipelineVersion, operators: Operators, decisions: FlowDecision[] = []): Map<string, string> {
  return new Map(
    stageNotebooks(pipeline, operators, decisions).flatMap(({ name, nodes }) =>
      nodes.map((n) => [n.id, `${name}#${name.toLowerCase().replaceAll(" ", "_")}`] as const),
    ),
  );
}

const latest = (stages: Stage[]): Stage => stages.reduce((a, b) => (STAGES.indexOf(b) > STAGES.indexOf(a) ? b : a));

/** Output ports a cell gives on; diagnostics (a code step's display and interface) are not names. */
function outputPorts(node: Node, operators: Operators): string[] {
  const operator = operators.get(node.operator);
  const declared = (operator?.outputs ?? []).filter((o) => o.kind !== "diagnostics").map((o) => String(o.name));
  return [...declared, ...namedPorts(operator, node.params, "output")];
}
