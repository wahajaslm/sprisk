import type { NotebookExecution, NotebookVersion } from "@sprisk/contracts";
import { parse } from "@sprisk/contracts";
import { describe, expect, it } from "vitest";

import { cellsFromFile, firstVersion, nextNotebookVersion, toIpynb } from "../src/notebook/document.ts";

const PROJECT = "prj_00000000000000000000000000";

describe("a notebook document (ADR-0036)", () => {
  it("starts as a valid first version with no parent", () => {
    const version = firstVersion(PROJECT, "Sales", [{ id: "c1", kind: "code", source: "x = 1" }]);
    expect(parse("NotebookVersion", version)).toEqual(version);
    expect(version.parent_id).toBeUndefined();
    expect(version.notebook_id).toMatch(/^nb_/);
  });

  it("saves over the last version of the same notebook", () => {
    const first = firstVersion(PROJECT, "Sales", []);
    const next = nextNotebookVersion(first, { cells: [{ id: "c1", kind: "markdown", source: "# Hi" }] });
    expect(next.parent_id).toBe(first.id);
    expect(next.notebook_id).toBe(first.notebook_id);
    expect(next.id).not.toBe(first.id);
    expect(next.title).toBe("Sales");
  });

  it("reads code and Markdown cells from a .ipynb, keeping valid cell ids and dropping raw cells", () => {
    const ipynb = JSON.stringify({
      nbformat: 4,
      cells: [
        { id: "intro", cell_type: "markdown", source: ["# Sales\n", "Monthly."] },
        { id: "bad id!", cell_type: "code", source: "%matplotlib inline\nx = 1", outputs: [] },
        { cell_type: "raw", source: "ignored" },
      ],
    });
    const cells = cellsFromFile("sales.ipynb", ipynb);
    expect(cells.map((c) => [c.kind, c.source])).toEqual([
      ["markdown", "# Sales\nMonthly."],
      ["code", "%matplotlib inline\nx = 1"],
    ]);
    expect(cells[0]?.id).toBe("intro");
    expect(cells[1]?.id).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
  });

  it("reads # %% cells from a script, with [markdown] cells as text", () => {
    const script = "# %% [markdown]\n# # Sales\n# Monthly.\n\n# %%\nx = 1\n\n# %%\ny = x + 1\n";
    expect(cellsFromFile("sales.py", script).map((c) => [c.kind, c.source])).toEqual([
      ["markdown", "# Sales\nMonthly."],
      ["code", "x = 1"],
      ["code", "y = x + 1"],
    ]);
  });

  it("refuses a file that is not a notebook", () => {
    expect(() => cellsFromFile("x.ipynb", "{nope")).toThrow("x.ipynb is not a Jupyter notebook");
  });

  it("exports nbformat 4.5 with each cell's last outputs and execution count", () => {
    const version: NotebookVersion = firstVersion(PROJECT, "Sales", [
      { id: "m", kind: "markdown", source: "# Sales" },
      { id: "c", kind: "code", source: "print('hi')\n1 + 1" },
      { id: "e", kind: "code", source: "boom" },
    ]);
    const outputs = new Map<string, NotebookExecution>([
      [
        "c",
        {
          status: "ok",
          execution_count: 3,
          outputs: [
            { kind: "text", text: "hi\n", channel: "stdout" },
            { kind: "text", text: "2" },
            { kind: "image", png_base64: "iVBOR" },
          ],
        },
      ],
      ["e", { status: "error", execution_count: 4, outputs: [], error: { name: "NameError", message: "boom", traceback: ["NameError: boom"] } }],
    ]);
    const nb = toIpynb(version, outputs);
    expect(nb.nbformat_minor).toBe(5);
    expect(nb.cells[0]).toEqual({ id: "m", cell_type: "markdown", metadata: {}, source: "# Sales" });
    expect(nb.cells[1]).toMatchObject({ id: "c", cell_type: "code", execution_count: 3 });
    expect(nb.cells[1]?.outputs).toEqual([
      { output_type: "stream", name: "stdout", text: "hi\n" },
      { output_type: "execute_result", execution_count: 3, data: { "text/plain": "2" }, metadata: {} },
      { output_type: "display_data", data: { "image/png": "iVBOR" }, metadata: {} },
    ]);
    expect(nb.cells[2]?.outputs).toEqual([{ output_type: "error", ename: "NameError", evalue: "boom", traceback: ["NameError: boom"] }]);
  });
});
