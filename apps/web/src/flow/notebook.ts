import type { CodeSplit, Operator, PipelineVersion } from "@sprisk/contracts";
import { ulid } from "ulid";

/** The code step whose ports are variable names (ADR-0031). */
export const NOTEBOOK_OPERATOR = "sprisk.code.python@2.0.0";

const CELL_MARKER = /^# %%.*$/m;

/** Cells from a file the person picked or pasted: a .ipynb's code cells, or text split on
 * `# %%` markers. Only the cell text is read here; Python reads the code (POST /code/split). */
export function cellsFromFile(name: string, text: string): string[] {
  if (name.endsWith(".ipynb")) return notebookCells(name, text);
  return text
    .split(CELL_MARKER)
    .map((cell) => cell.trim())
    .filter((cell) => cell !== "");
}

function notebookCells(name: string, text: string): string[] {
  let notebook: unknown;
  try {
    notebook = JSON.parse(text);
  } catch (e) {
    throw new Error(`${name} is not a Jupyter notebook: ${e instanceof Error ? e.message : String(e)}`);
  }
  const cells = typeof notebook === "object" && notebook !== null && "cells" in notebook ? notebook.cells : undefined;
  if (!Array.isArray(cells)) throw new Error(`${name} is not a Jupyter notebook: it has no cells`);
  return cells.filter(isCodeCell).map((cell) => (Array.isArray(cell.source) ? cell.source.join("") : cell.source));
}

type CodeCell = { cell_type: "code"; source: string | string[] };

const isCodeCell = (cell: unknown): cell is CodeCell =>
  typeof cell === "object" &&
  cell !== null &&
  "cell_type" in cell &&
  cell.cell_type === "code" &&
  "source" in cell &&
  (typeof cell.source === "string" || (Array.isArray(cell.source) && cell.source.every((s) => typeof s === "string")));

/** Ports a step's params name (ADR-0031), as the compiler adds them: tables, listed under a
 * setting marked `x-sprisk-ports`. */
export function namedPorts(operator: Operator | undefined, params: Record<string, unknown> | undefined, side: "input" | "output"): string[] {
  const properties = operator?.params_schema["properties"];
  if (typeof properties !== "object" || properties === null || !params) return [];
  const key = Object.entries(properties).find(([, schema]) => typeof schema === "object" && schema !== null && schema["x-sprisk-ports"] === side)?.[0];
  const names = key === undefined ? undefined : params[key];
  return Array.isArray(names) ? names.filter((n): n is string => typeof n === "string") : [];
}

/** A new flow (no parent) with one code step per split step, linked by variable name. */
export function flowFromSplit(split: CodeSplit, projectId: string): PipelineVersion {
  const id = (step: number) => `cell_${step + 1}`;
  return {
    schema_version: "sprisk.pipeline_version/v1",
    id: `plv_${ulid()}`,
    project_id: projectId,
    nodes: split.steps.map((step, i) => ({
      id: id(i),
      operator: NOTEBOOK_OPERATOR,
      params: {
        source: step.source,
        ...(step.inputs.length > 0 ? { inputs: step.inputs } : {}),
        ...(step.outputs.length > 0 ? { outputs: step.outputs } : {}),
      },
    })),
    edges: split.links.map((link) => ({ from: `${id(link.from_step)}.${link.name}`, to: `${id(link.to_step)}.${link.name}` })),
    created_at: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
  };
}
