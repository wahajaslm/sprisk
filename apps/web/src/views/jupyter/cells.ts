import type * as nbformat from "@jupyterlab/nbformat";
import type { PipelineVersion } from "@sprisk/contracts";

import { isCodeOperator } from "../../flow/edit.ts";
import type { NotebookStep } from "../../flow/notebook.ts";

/** Which step a JupyterLab cell belongs to, kept in the cell's metadata (ADR-0034). `cells`: a
 * cell of a code step. `code`: a v1 code step. `call`: a built-in step's call. `function`: a
 * built-in step's code, in a collapsed cell before its call. */
export type CellRole = "cells" | "code" | "call" | "function";
export type CellTag = { node: string; role: CellRole };

/** A built-in step's code for its collapsed cell, and whether it may be edited (ADR-0028). */
export type FunctionCode = { source: string; editable: boolean };

const cell = (source: string, tag: CellTag, metadata: Partial<nbformat.ICodeCellMetadata> = {}): nbformat.ICodeCell => ({
  cell_type: "code",
  source,
  metadata: { sprisk: tag, ...metadata },
  outputs: [],
  execution_count: null,
});

/** The notebook's steps as JupyterLab cells. Outputs and run counts are filled in later. */
export function toCells(steps: NotebookStep[], functions: Map<string, FunctionCode>): nbformat.ICodeCell[] {
  return steps.flatMap((step) => {
    if (step.kind === "cells") return step.cells.map((c) => cell(c, { node: step.nodeId ?? "", role: "cells" }));
    if (step.kind === "code") return [cell(step.source, { node: step.nodeId, role: "code" })];
    const code = functions.get(step.nodeId);
    const call = cell(step.call, { node: step.nodeId, role: "call" }, { editable: false });
    if (!code) return [call];
    return [cell(code.source, { node: step.nodeId, role: "function" }, { editable: code.editable, jupyter: { source_hidden: true } }), call];
  });
}

/** A cell as read from the notebook: its text and metadata. */
export type ReadCell = { source: string; metadata: Partial<nbformat.ICellMetadata> };

/** The steps the notebook's cells now hold, and each built-in step's code as its cell holds it.
 * Cells in a row that belong to one code step stay one step; a cell with no step (a new one)
 * is a step of its own. `saved` gives a v1 code step the table it reads. */
export function fromCells(cells: ReadCell[], saved: NotebookStep[]): { steps: NotebookStep[]; functions: Map<string, string> } {
  const steps: NotebookStep[] = [];
  const functions = new Map<string, string>();
  const placed = new Set<string>();
  const once = (key: string, node: string) => {
    if (placed.has(key)) throw new Error(`Step ${node} is in the notebook twice. Delete one copy.`);
    placed.add(key);
  };
  for (const { source, metadata } of cells) {
    const tag = readTag(metadata["sprisk"]);
    if (tag?.role === "function") {
      once(`function:${tag.node}`, tag.node);
      functions.set(tag.node, source);
    } else if (tag?.role === "call") {
      once(tag.node, tag.node);
      steps.push({ kind: "builtin", nodeId: tag.node, call: source });
    } else if (tag?.role === "code") {
      once(tag.node, tag.node);
      const before = saved.find((s) => s.nodeId === tag.node);
      steps.push({ kind: "code", nodeId: tag.node, source, data: before?.kind === "code" ? before.data : undefined });
    } else {
      const last = steps.at(-1);
      if (tag && last?.kind === "cells" && last.nodeId === tag.node) last.cells.push(source);
      else steps.push({ kind: "cells", nodeId: tag?.node, cells: [source] });
    }
  }
  return { steps, functions };
}

/** The step a cell belongs to, from its `sprisk` metadata; undefined for a cell sprisk did not
 * make (a new one). */
export function readTag(tag: unknown): CellTag | undefined {
  if (typeof tag !== "object" || tag === null || !("node" in tag) || !("role" in tag)) return undefined;
  const { node, role } = tag as Record<string, unknown>;
  if (typeof node !== "string" || node === "" || !["cells", "code", "call", "function"].includes(String(role))) return undefined;
  return { node, role: role as CellRole };
}

/** The base for the next version, holding the code the notebook's cells now hold: a v1 code
 * step's source, and a built-in step's own code (ADR-0028), or none again when it matches its
 * operator's. Same id: it is never saved, only built on. */
export function withCellCode(
  base: PipelineVersion,
  steps: NotebookStep[],
  functions: Map<string, string>,
  builtin: (node: PipelineVersion["nodes"][number]) => { source: string; function: string } | undefined,
): PipelineVersion {
  return {
    ...base,
    nodes: base.nodes.map((node) => {
      const code = steps.find((s) => s.kind === "code" && s.nodeId === node.id);
      if (code?.kind === "code" && isCodeOperator(node.operator)) return { ...node, params: { ...node.params, source: code.source } };
      const own = functions.get(node.id);
      const operator = builtin(node);
      if (own === undefined || !operator) return node;
      const { code: _old, ...rest } = node;
      return own === operator.source ? rest : { ...rest, code: { source: own, function: node.code?.function ?? operator.function } };
    }),
  };
}
