import type { FlowDecision, Node, Operator, PipelineVersion } from "@sprisk/contracts";

import { isCodeOperator } from "../flow/edit.ts";
import { namedPorts, nodeOf, notebookOrder, outputName } from "../flow/notebook.ts";
import { portOf, stepOf } from "../flow/ports.ts";
import { type Stage, STAGE_OF, STAGE_TITLE, STAGES, stageOf } from "../flow/stages.ts";

type Operators = Map<string, Operator>;

/** Each step's stage (ADR-0055, ADR-0065): the one it keeps, else the one its operator implies,
 * but never before a stage it reads from. A look at the loaded rows is in Explore; a look at
 * what the split wrote stays with the split; a transform that reads the split's rows is fitted
 * on the training rows, so it is feature work, not cleaning. */
export function stagesOf(pipeline: PipelineVersion, operators: Operators): Map<string, Stage> {
  const placed = new Map<string, Stage>();
  for (const node of notebookOrder(pipeline)) {
    const operator = operators.get(node.operator);
    const read = pipeline.edges.filter((e) => stepOf(e.to) === node.id).map((e) => placed.get(stepOf(e.from)) ?? "Load");
    const own = node.stage ? STAGE_OF[node.stage] : operator ? stageOf(operator) : "Explore";
    const at = latest([own, ...read]);
    placed.set(node.id, at === "Split" && (own === "Clean" || own === "Features") ? "Features" : at);
  }
  return placed;
}

/** One notebook section: one standard stage, its steps in working order, and the decisions
 * that shaped them. `name` is the stage's key (saved notebooks use it); `title` is for people;
 * `home` is the stage a cell added to it takes. */
export type Section = { name: Stage; title: string; home: Stage; nodes: Node[]; decisions: FlowDecision[] };

/** The flow as one notebook per standard stage, in working order, each step after the steps it
 * reads. A decision's activity never makes a section of its own (ADR-0065): the steps it shaped
 * keep their stage, and the stage lists the decision. */
export function stageNotebooks(pipeline: PipelineVersion, operators: Operators, decisions: FlowDecision[] = []): Section[] {
  const placed = stagesOf(pipeline, operators);
  const sections = new Map<Stage, Section>();
  for (const node of notebookOrder(pipeline)) {
    const stage = placed.get(node.id) ?? "Unknown";
    const section = sections.get(stage) ?? { name: stage, title: STAGE_TITLE[stage], home: stage, nodes: [], decisions: [] };
    section.nodes.push(node);
    for (const decision of decisions) {
      if (decision.steps.includes(node.id) && !section.decisions.includes(decision)) section.decisions.push(decision);
    }
    sections.set(stage, section);
  }
  return [...sections.values()].sort((a, b) => STAGES.indexOf(a.name) - STAGES.indexOf(b.name));
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
