import type { DisplayItem, NotebookCell, NotebookExecution, NotebookVersion } from "@sprisk/contracts";
import { ulid } from "ulid";

import { timestamp } from "../flow/edit.ts";

/** Jupyter's cell id rule (nbformat 4.5), which the contract uses too. */
const CELL_ID = /^[A-Za-z0-9_-]{1,64}$/;
const CELL_MARKER = /^# %%(.*)$/;

export const newCellId = () => ulid().toLowerCase();

/** Local mode's one project (the CLI's LOCAL_PROJECT), for a notebook made before any flow. */
export const LOCAL_PROJECT = "prj_00000000000000000000000000";

/** A new notebook: its first saved version (ADR-0036). */
export function firstVersion(projectId: string, title: string, cells: NotebookCell[]): NotebookVersion {
  return {
    schema_version: "sprisk.notebook_version/v1",
    id: `nbv_${ulid()}`,
    notebook_id: `nb_${ulid()}`,
    project_id: projectId,
    title,
    cells,
    created_at: timestamp(),
  };
}

/** Versions are immutable: a save is a new version over the last one (rule 5). */
export function nextNotebookVersion(base: NotebookVersion, change: Partial<Pick<NotebookVersion, "cells" | "title">>): NotebookVersion {
  return { ...base, ...change, id: `nbv_${ulid()}`, parent_id: base.id, created_at: timestamp() };
}

/** Cells from a file the person picked: a .ipynb's code and Markdown cells, or a script split
 * on `# %%` markers, where `# %% [markdown]` cells are comment lines of Markdown. */
export function cellsFromFile(name: string, text: string): NotebookCell[] {
  return name.endsWith(".ipynb") ? ipynbCells(name, text) : scriptCells(text);
}

function ipynbCells(name: string, text: string): NotebookCell[] {
  let notebook: unknown;
  try {
    notebook = JSON.parse(text);
  } catch (e) {
    throw new Error(`${name} is not a Jupyter notebook: ${e instanceof Error ? e.message : String(e)}`);
  }
  const cells = typeof notebook === "object" && notebook !== null && "cells" in notebook ? notebook.cells : undefined;
  if (!Array.isArray(cells)) throw new Error(`${name} is not a Jupyter notebook: it has no cells`);
  return cells.filter(isReadable).map((cell) => ({
    id: typeof cell.id === "string" && CELL_ID.test(cell.id) ? cell.id : newCellId(),
    kind: cell.cell_type,
    source: Array.isArray(cell.source) ? cell.source.join("") : cell.source,
  }));
}

type ReadableCell = { id?: unknown; cell_type: "code" | "markdown"; source: string | string[] };

const isReadable = (cell: unknown): cell is ReadableCell =>
  typeof cell === "object" &&
  cell !== null &&
  "cell_type" in cell &&
  (cell.cell_type === "code" || cell.cell_type === "markdown") &&
  "source" in cell &&
  (typeof cell.source === "string" || (Array.isArray(cell.source) && cell.source.every((s) => typeof s === "string")));

function scriptCells(text: string): NotebookCell[] {
  const cells: { kind: NotebookCell["kind"]; lines: string[] }[] = [];
  for (const line of text.split("\n")) {
    const marker = CELL_MARKER.exec(line);
    if (marker) cells.push({ kind: marker[1]?.includes("[markdown]") ? "markdown" : "code", lines: [] });
    else if (cells.length === 0) cells.push({ kind: "code", lines: [line] });
    else cells.at(-1)?.lines.push(line);
  }
  return cells
    .map(({ kind, lines }) => ({
      id: newCellId(),
      kind,
      source: (kind === "markdown" ? lines.map((l) => l.replace(/^# ?/, "")) : lines).join("\n").trim(),
    }))
    .filter((cell) => cell.source !== "");
}

/** The notebook as nbformat 4.5, with each code cell's last outputs from this session. */
export function toIpynb(version: NotebookVersion, outputs: Map<string, NotebookExecution>) {
  return {
    nbformat: 4,
    nbformat_minor: 5,
    metadata: {
      kernelspec: { name: "python3", display_name: "Python 3", language: "python" },
      language_info: { name: "python" },
      // Outputs come from a live session: scratch, not a record of a run (ADR-0036).
      sprisk: { outputs: "session scratch" },
    },
    cells: version.cells.map((cell) => {
      if (cell.kind === "markdown") return { id: cell.id, cell_type: "markdown", metadata: {}, source: cell.source };
      const done = outputs.get(cell.id);
      const count = done?.execution_count ?? null;
      return {
        id: cell.id,
        cell_type: "code",
        metadata: {},
        execution_count: count,
        source: cell.source,
        outputs: done ? [...done.outputs.map((item) => ipynbOutput(item, count)), ...(done.error ? [errorOutput(done.error)] : [])] : [],
      };
    }),
  };
}

function ipynbOutput(item: DisplayItem, count: number | null) {
  if (item.kind === "text" && item.channel) return { output_type: "stream", name: item.channel, text: item.text ?? "" };
  if (item.kind === "text") return { output_type: "execute_result", execution_count: count, data: { "text/plain": item.text ?? "" }, metadata: {} };
  return { output_type: "display_data", data: displayData(item), metadata: {} };
}

function displayData(item: DisplayItem): Record<string, unknown> {
  if (item.kind === "image") return { "image/png": item.png_base64 ?? "" };
  if (item.kind === "table" && item.table) {
    const { columns, rows, total_rows } = item.table;
    const lines = [columns.map((c) => c.name).join("\t"), ...rows.map((r) => r.values.join("\t"))];
    return { "text/plain": `${lines.join("\n")}\n[${total_rows} rows]` };
  }
  const figure = item.figure;
  if (!figure) return { "text/plain": "" };
  if (figure.format === "svg") return { "image/svg+xml": figure.content };
  if (figure.format === "plotly_json") return { "application/vnd.plotly.v1+json": JSON.parse(figure.content) as unknown };
  return { "application/vnd.vegalite.v5+json": JSON.parse(figure.content) as unknown };
}

const errorOutput = (error: NonNullable<NotebookExecution["error"]>) => ({
  output_type: "error",
  ename: error.name,
  evalue: error.message,
  traceback: error.traceback,
});
