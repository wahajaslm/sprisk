import type { DisplayItem, PipelineVersion } from "@sprisk/contracts";
import { describe, expect, it } from "vitest";

import { NOTEBOOK_OPERATOR, type NotebookStep } from "../src/flow/notebook.ts";
import { fromCells, toCells, withCellCode } from "../src/views/jupyter/cells.ts";
import { displayOutputs, errorOutput, tableSizeOutput } from "../src/views/jupyter/outputs.ts";
import { pipeline, tablePage } from "./fixtures.ts";

const steps: NotebookStep[] = [
  { kind: "builtin", nodeId: "load", call: "load_data = f(path=Path('/d/iris.csv'))" },
  { kind: "cells", nodeId: "cell_1", cells: ["def tidy(t):\n    return t", "clean = tidy(load_data)"] },
  { kind: "code", nodeId: "code_1", source: "data.head()", data: "clean" },
];
const functions = new Map([["load", { source: "def f(path):\n    ...", editable: true }]]);

describe("a flow as JupyterLab cells (ADR-0034)", () => {
  const cells = toCells(steps, functions);

  it("gives a built-in step a collapsed cell with its code, then its call, read-only", () => {
    expect(cells.slice(0, 2)).toEqual([
      {
        cell_type: "code",
        source: "def f(path):\n    ...",
        metadata: { sprisk: { node: "load", role: "function" }, editable: true, jupyter: { source_hidden: true } },
        outputs: [],
        execution_count: null,
      },
      {
        cell_type: "code",
        source: "load_data = f(path=Path('/d/iris.csv'))",
        metadata: { sprisk: { node: "load", role: "call" }, editable: false },
        outputs: [],
        execution_count: null,
      },
    ]);
  });

  it("keeps each cell of a code step, and a v1 code step as one cell", () => {
    expect(cells.slice(2).map((c) => [c.source, c.metadata["sprisk"]])).toEqual([
      ["def tidy(t):\n    return t", { node: "cell_1", role: "cells" }],
      ["clean = tidy(load_data)", { node: "cell_1", role: "cells" }],
      ["data.head()", { node: "code_1", role: "code" }],
    ]);
  });

  it("reads the cells back as the same steps", () => {
    const read = fromCells(cells.map((c) => ({ source: String(c.source), metadata: c.metadata })), steps);
    expect(read.steps).toEqual(steps);
    expect(read.functions).toEqual(new Map([["load", "def f(path):\n    ..."]]));
  });

  it("reads a new cell as a new step, and splits a group a new cell lands in", () => {
    const read = cells.map((c) => ({ source: String(c.source), metadata: c.metadata }));
    read.splice(3, 0, { source: "x = 1", metadata: {} });
    expect(fromCells(read, steps).steps.map((s) => [s.kind, s.nodeId])).toEqual([
      ["builtin", "load"],
      ["cells", "cell_1"],
      ["cells", undefined],
      ["cells", "cell_1"],
      ["code", "code_1"],
    ]);
  });

  it("refuses a built-in step that is in the notebook twice", () => {
    const read = cells.map((c) => ({ source: String(c.source), metadata: c.metadata }));
    read.push(read[1]!);
    expect(() => fromCells(read, steps)).toThrow("Step load is in the notebook twice. Delete one copy.");
  });
});

describe("the base for the next version holds the notebook's own code", () => {
  const base: PipelineVersion = {
    ...pipeline,
    nodes: [
      { id: "load", operator: "sprisk.io.file_source@1.0.0", params: {} },
      { id: "code_1", operator: "sprisk.code.python@1.2.0", params: { source: "data", output: "df" } },
      { id: "cell_1", operator: NOTEBOOK_OPERATOR, params: { source: "x = 1" } },
    ],
    edges: [],
  };
  const builtin = () => ({ source: "def f(path):\n    ...", function: "f" });

  it("gives a v1 code step its new source and a built-in step its edited code", () => {
    const next = withCellCode(base, [{ kind: "code", nodeId: "code_1", source: "data.head()", data: undefined }], new Map([["load", "def f(path):\n    return 1"]]), builtin);
    expect(next.id).toBe(base.id);
    expect(next.nodes[0]).toEqual({ id: "load", operator: "sprisk.io.file_source@1.0.0", params: {}, code: { source: "def f(path):\n    return 1", function: "f" } });
    expect(next.nodes[1]?.params).toEqual({ source: "data.head()", output: "df" });
    expect(next.nodes[2]).toEqual(base.nodes[2]);
  });

  it("drops a built-in step's own code when it matches the operator's again", () => {
    const edited = { ...base, nodes: [{ ...base.nodes[0]!, code: { source: "old", function: "f" } }, ...base.nodes.slice(1)] };
    expect(withCellCode(edited, [], new Map([["load", "def f(path):\n    ..."]]), builtin).nodes[0]).toEqual(base.nodes[0]);
  });
});

describe("sprisk outputs as Jupyter outputs", () => {
  it("turns printed text, tables and figures into Jupyter's output types, in order", () => {
    const items: DisplayItem[] = [
      { kind: "text", text: "150\n" },
      { kind: "text", text: "careful\n", channel: "stderr" },
      { kind: "table", table: { ...tablePage(0, 1), total_rows: 150 } },
      { kind: "figure", figure: { library: "matplotlib", format: "svg", content: "<svg/>" } },
      { kind: "figure", figure: { library: "plotly", format: "plotly_json", content: '{"data":[]}' } },
      { kind: "figure", figure: { library: "altair", format: "vega_lite_json", content: '{"mark":"bar"}' } },
      { kind: "image", png_base64: "iVBORw0KGgo=" },
    ];
    const out = displayOutputs(items);
    expect(out[0]).toEqual({ output_type: "stream", name: "stdout", text: "150\n" });
    expect(out[1]).toEqual({ output_type: "stream", name: "stderr", text: "careful\n" });
    expect(out[2]).toMatchObject({ output_type: "display_data", data: { "text/plain": "1 of 150 rows" } });
    expect(String((out[2] as { data: Record<string, unknown> }).data["text/html"])).toContain('<table class="dataframe">');
    expect(out.slice(3).map((o) => Object.keys((o as { data: object }).data))).toEqual([
      ["image/svg+xml"],
      ["application/vnd.plotly.v1+json"],
      ["application/vnd.vegalite.v5+json"],
      ["image/png"],
    ]);
  });

  it("escapes table text: dataset text is untrusted (rule 7)", () => {
    const page = tablePage(0, 1);
    const hostile = { ...page, rows: [{ values: page.columns.map(() => "<img src=x onerror=alert(1)>"), missing: [] }] };
    const html = String((displayOutputs([{ kind: "table", table: hostile }])[0] as { data: Record<string, unknown> }).data["text/html"]);
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("says when an output item has no content", () => {
    expect(displayOutputs([{ kind: "figure" }])).toEqual([{ output_type: "stream", name: "stderr", text: "Output item 1 (figure) has no content.\n" }]);
  });

  it("shows a failed step as a Jupyter error, and a table's size as text", () => {
    expect(errorOutput({ code: "code_error", message: "NameError: x" })).toEqual({ output_type: "error", ename: "code_error", evalue: "NameError: x", traceback: ["code_error: NameError: x"] });
    expect(tableSizeOutput("load_data", 344, 17)).toEqual({ output_type: "display_data", data: { "text/plain": "load_data: 344 rows × 17 columns" }, metadata: {} });
  });
});
