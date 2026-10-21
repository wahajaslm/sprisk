import type { Node, NotebookCell, Operator, OperatorSource, PipelineVersion } from "@sprisk/contracts";

import { notebookSteps } from "../flow/notebook.ts";
import { flowName } from "../flow/labels.ts";
import { STAGES, stageOf } from "../flow/stages.ts";
import { newCellId } from "./document.ts";

export type FlowNotebook = { title: string; cells: NotebookCell[] };

const cell = (kind: NotebookCell["kind"], source: string): NotebookCell => ({ id: newCellId(), kind, source });

/** First line of a cell written for a step of the flow: saving knows the cell is that step. */
export const flowStepLine = (id: string) => `# Flow step: ${id}`;

/** The flow as notebooks, one per stage when it has several (ADR-0054). A built-in step is a
 * heading, its code to read, and a cell marked as that step that calls it, so it runs in the
 * flow's kernel: the operator imported under the step's name, or, for a step whose code was
 * edited in this flow, that code. */
export function flowNotebooks(flow: PipelineVersion, operators: Map<string, Operator>, sources: Map<string, OperatorSource>): FlowNotebook[] {
  const byStage = new Map<string, NotebookCell[]>();
  for (const step of notebookSteps(flow, operators)) {
    const node = step.nodeId ? flow.nodes.find((n) => n.id === step.nodeId) : undefined;
    const operator = node ? operators.get(node.operator) : undefined;
    const stage = operator ? stageOf(operator) : "Explore";
    const cells = byStage.get(stage) ?? [];
    byStage.set(stage, cells);
    if (step.kind === "cells") cells.push(...step.cells.map((source) => cell("code", step.nodeId ? `${flowStepLine(step.nodeId)}\n${source}` : source)));
    else if (step.kind === "code") cells.push(cell("code", `${flowStepLine(step.nodeId)}\n${step.source}`));
    else cells.push(...builtInCells(node!, operator, sources.get(node!.operator), step.call));
  }
  const stages = STAGES.filter((stage) => byStage.has(stage));
  if (stages.length <= 1) return [{ title: `${flowName(flow)}_flow.ipynb`, cells: [...byStage.values()].flat() }];
  return stages.map((stage, i) => ({ title: `${String(i + 1).padStart(2, "0")}_Stage_${stage}.ipynb`, cells: byStage.get(stage)! }));
}

const fenced = (text: string) => `\`\`\`python\n${text.endsWith("\n") ? text : `${text}\n`}\`\`\``;

function builtInCells(node: Node, operator: Operator | undefined, source: OperatorSource | undefined, call: string): NotebookCell[] {
  const path = call.includes("Path(") ? ["from pathlib import Path"] : [];
  let shown: string;
  let defines: string[];
  if (node.code) {
    shown = `Code of step \`${node.id}\`, edited in this flow from \`${node.operator}\`:\n\n${fenced(node.code.source)}`;
    defines = [node.code.source.trimEnd()];
  } else {
    if (!source || !operator) throw new Error(`no code was read for ${node.operator}`);
    const [module, fn] = operator.entrypoint.split(":");
    shown = `Code of \`${node.operator}\` (${source.path}):\n\n${fenced(source.text)}`;
    defines = [`from ${module} import ${fn} as ${node.id}`];
  }
  return [
    cell("markdown", `### Stage Step: \`${node.id}\``),
    cell("markdown", shown),
    cell("code", [flowStepLine(node.id), ...path, ...defines, call].join("\n")),
  ];
}
