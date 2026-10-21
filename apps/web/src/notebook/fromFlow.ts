import type { NotebookCell, Operator, OperatorSource, PipelineVersion } from "@sprisk/contracts";

import { notebookSteps } from "../flow/notebook.ts";
import { flowName } from "../flow/labels.ts";
import { STAGES, stageOf } from "../flow/stages.ts";
import { newCellId } from "./document.ts";

export type FlowNotebook = { title: string; cells: NotebookCell[] };

const cell = (kind: NotebookCell["kind"], source: string): NotebookCell => ({ id: newCellId(), kind, source });

/** The flow as notebooks, one per stage when it has several (ADR-0054). A built-in step is a
 * heading the notebook's sync knows it by, its operator's code to read, and a cell that imports
 * the operator under the step's name and calls it, so it runs in the flow's kernel. */
export function flowNotebooks(flow: PipelineVersion, operators: Map<string, Operator>, sources: Map<string, OperatorSource>): FlowNotebook[] {
  const byStage = new Map<string, NotebookCell[]>();
  for (const step of notebookSteps(flow, operators)) {
    const node = step.nodeId ? flow.nodes.find((n) => n.id === step.nodeId) : undefined;
    const operator = node ? operators.get(node.operator) : undefined;
    const stage = operator ? stageOf(operator) : "Explore";
    const cells = byStage.get(stage) ?? [];
    byStage.set(stage, cells);
    if (step.kind === "cells") cells.push(...step.cells.map((source) => cell("code", source)));
    else if (step.kind === "code") cells.push(cell("code", step.source));
    else cells.push(...builtInCells(step.nodeId, node!.operator, operator, sources.get(node!.operator), step.call));
  }
  const stages = STAGES.filter((stage) => byStage.has(stage));
  if (stages.length <= 1) return [{ title: `${flowName(flow)}_flow.ipynb`, cells: [...byStage.values()].flat() }];
  return stages.map((stage, i) => ({ title: `${String(i + 1).padStart(2, "0")}_Stage_${stage}.ipynb`, cells: byStage.get(stage)! }));
}

function builtInCells(id: string, ref: string, operator: Operator | undefined, source: OperatorSource | undefined, call: string): NotebookCell[] {
  if (!source) throw new Error(`no code was read for ${ref}`);
  const text = source.text.endsWith("\n") ? source.text : `${source.text}\n`;
  const code = `Code of \`${ref}\` (${source.path}):\n\n\`\`\`python\n${text}\`\`\``;
  const [module, fn] = operator?.entrypoint.split(":") ?? [];
  const imports = [...(call.includes("Path(") ? ["from pathlib import Path"] : []), ...(module && fn ? [`from ${module} import ${fn} as ${id}`] : [])];
  return [cell("markdown", `### Stage Step: \`${id}\``), cell("markdown", code), cell("code", [...imports, call].join("\n"))];
}
