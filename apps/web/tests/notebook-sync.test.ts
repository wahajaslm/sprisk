import type { CodeSplit, NotebookVersion, PipelineVersion } from "@sprisk/contracts";
import { parse } from "@sprisk/contracts";
import { describe, expect, it } from "vitest";

import { cellsFromFlow, stepsIntoFlow, stepsOutOfFlow } from "../src/notebook/sync.ts";
import { operators, pipeline } from "./fixtures.ts";

const byRef = new Map(operators.map((o) => [o.id, o]));

const NB = "nb_01JAAAAAAAAAAAAAAAAAAAAAAA";
const PROJECT = pipeline.project_id;

const notebook: NotebookVersion = {
  schema_version: "sprisk.notebook_version/v1",
  id: "nbv_01JAAAAAAAAAAAAAAAAAAAAAAB",
  notebook_id: NB,
  project_id: PROJECT,
  title: "Sales",
  cells: [
    { id: "intro", kind: "markdown", source: "# Sales" },
    { id: "a", kind: "code", source: "TOP_N = 5" },
    { id: "b", kind: "code", source: "import pandas as pd\nsales = pd.read_csv('s.csv')" },
    { id: "c", kind: "code", source: "top = sales.nlargest(TOP_N, 'units')" },
  ],
  created_at: "2026-10-18T12:00:00Z",
};

/** What Python reads in the three code cells: `b` makes sales, `c` reads it; TOP_N is copied. */
const split: CodeSplit = {
  steps: [
    { source: "TOP_N = 5", cells: [0], parameters: [{ name: "TOP_N", value: 5 }], inputs: [], outputs: [] },
    { source: "import pandas as pd\nsales = pd.read_csv('s.csv')", cells: [1], parameters: [], inputs: [], outputs: ["sales"] },
    { source: "TOP_N = 5\ntop = sales.nlargest(TOP_N, 'units')", cells: [2], parameters: [{ name: "TOP_N", value: 5 }], inputs: ["sales"], outputs: [] },
  ],
  links: [{ from_step: 1, to_step: 2, name: "sales" }],
  notes: [],
};

const synced = (base: PipelineVersion | undefined, s: CodeSplit = split, nb: NotebookVersion = notebook) => {
  const done = stepsIntoFlow({ base, projectId: PROJECT, notebook: nb, split: s, operators: byRef });
  if (!("version" in done)) throw new Error(JSON.stringify(done));
  return done.version;
};

describe("a notebook's steps in its flow (ADR-0037)", () => {
  it("starts a flow from a notebook: one step per split step, linked by name, each naming its cells", () => {
    const version = synced(undefined);
    expect(parse("PipelineVersion", version).parent_id).toBeUndefined();
    expect(version.nodes.map((n) => n.id)).toEqual(["sales_1", "sales_2", "sales_3"]);
    expect(version.edges).toEqual([{ from: "sales_2.sales", to: "sales_3.sales" }]);
    expect(version.nodes[2]).toMatchObject({
      operator: "sprisk.code.python@2.0.0",
      params: { source: split.steps[2]!.source, inputs: ["sales"], outputs: [] },
      from_notebook: { notebook_version_id: notebook.id, notebook_id: NB, cells: ["c"] },
    });
  });

  it("keeps every other step of the flow and links a name it reads to the step that makes it", () => {
    const base: PipelineVersion = {
      ...pipeline,
      nodes: [...pipeline.nodes, { id: "orders", operator: "sprisk.code.python@2.0.0", params: { source: "orders = 1", outputs: ["orders"] } }],
    };
    const reads: CodeSplit = { ...split, steps: [...split.steps.slice(0, 2), { ...split.steps[2]!, inputs: ["sales", "orders"] }] };
    const version = synced(base, reads);
    expect(version.parent_id).toBe(base.id);
    expect(version.nodes.slice(0, base.nodes.length)).toEqual(base.nodes);
    expect(version.edges).toEqual(expect.arrayContaining([...base.edges, { from: "orders.orders", to: "sales_3.orders" }]));
  });

  it("refuses a name no cell and no step of the flow makes", () => {
    const reads: CodeSplit = { ...split, steps: [...split.steps.slice(0, 2), { ...split.steps[2]!, inputs: ["sales", "lookup"] }] };
    expect(stepsIntoFlow({ base: pipeline, projectId: PROJECT, notebook, split: reads, operators: byRef })).toEqual({
      refused: "No step in this pipeline makes lookup. Pick the cells that make it too, or create their node first.",
    });
  });

  it("saving again replaces the notebook's steps, keeping each step's id and the settings exposed on it", () => {
    const first = synced(pipeline);
    const exposed: PipelineVersion = {
      ...first,
      nodes: first.nodes.map((n) => (n.id === "sales_3" ? { ...n, params: { ...n.params, parameters: { TOP_N: 10 } } } : n)),
    };
    const edited = { ...notebook, id: "nbv_01JAAAAAAAAAAAAAAAAAAAAAAC", cells: notebook.cells.map((c) => (c.id === "c" ? { ...c, source: "top = sales.head(TOP_N)" } : c)) };
    const resplit: CodeSplit = { ...split, steps: [...split.steps.slice(0, 2), { ...split.steps[2]!, source: "TOP_N = 5\ntop = sales.head(TOP_N)" }] };
    const second = synced(exposed, resplit, edited);
    const ids = second.nodes.map((n) => n.id);
    expect(ids.filter((id) => id.startsWith("sales_"))).toEqual(["sales_1", "sales_2", "sales_3"]);
    expect(second.nodes.find((n) => n.id === "sales_3")?.params).toEqual({ source: "TOP_N = 5\ntop = sales.head(TOP_N)", inputs: ["sales"], outputs: [], parameters: { TOP_N: 10 } });
  });

  it("does nothing when the notebook's steps are already what the flow holds", () => {
    const first = synced(pipeline);
    const again = { ...notebook, id: "nbv_01JAAAAAAAAAAAAAAAAAAAAAAD" };
    expect(stepsIntoFlow({ base: first, projectId: PROJECT, notebook: again, split, operators: byRef })).toEqual({ unchanged: true });
  });

  it("keeps a step of another notebook reading this notebook's output", () => {
    const first = synced(pipeline);
    const reader: PipelineVersion = {
      ...first,
      nodes: [...first.nodes, { id: "other", operator: "sprisk.code.python@2.0.0", params: { source: "n = len(sales)", inputs: ["sales"] } }],
      edges: [...first.edges, { from: "sales_2.sales", to: "other.sales" }],
    };
    const again = { ...notebook, id: "nbv_01JAAAAAAAAAAAAAAAAAAAAAAE" };
    const resplit: CodeSplit = { ...split, steps: split.steps.map((s) => ({ ...s, outputs: [] })), links: [] };
    const version = synced(reader, { ...resplit, steps: [resplit.steps[0]!, resplit.steps[1]!, { ...resplit.steps[2]!, inputs: [] }] }, again);
    expect(version.edges).toContainEqual({ from: "sales_2.sales", to: "other.sales" });
    expect(version.nodes.find((n) => n.id === "sales_2")?.params["outputs"]).toEqual(["sales"]);
  });
});

describe("a step edited on the canvas comes back to its cells (ADR-0037)", () => {
  const flow = synced(pipeline);
  const withSource = (id: string, source: string): PipelineVersion => ({
    ...flow,
    nodes: flow.nodes.map((n) => (n.id === id ? { ...n, params: { ...n.params, source } } : n)),
  });

  it("finds nothing to change when every step's code is its cells", () => {
    expect(cellsFromFlow(flow, notebook)).toBeUndefined();
  });

  it("rewrites the cell a step's code changed, leaving the lines copied from earlier cells out", () => {
    const cells = cellsFromFlow(withSource("sales_3", "TOP_N = 5\ntop = sales.nsmallest(TOP_N, 'units')"), notebook);
    expect(cells?.find((c) => c.id === "c")?.source).toBe("top = sales.nsmallest(TOP_N, 'units')");
    expect(cells?.map((c) => c.id)).toEqual(["intro", "a", "b", "c"]);
  });

  it("a magic line Python commented out in the step is not an edit", () => {
    const magic = { ...notebook, cells: notebook.cells.map((c) => (c.id === "b" ? { ...c, source: "%matplotlib inline\n" + c.source } : c)) };
    const flowWithMagic = withSource("sales_2", "# %matplotlib inline\n" + notebook.cells[2]!.source);
    expect(cellsFromFlow(flowWithMagic, magic)).toBeUndefined();
  });

  it("adds a cell for each new # %% part of a step's code", () => {
    const cells = cellsFromFlow(withSource("sales_3", "TOP_N = 5\ntop = sales.head(TOP_N)\n\n# %%\nprint(top)"), notebook);
    expect(cells?.map((c) => c.source)).toEqual(["# Sales", "TOP_N = 5", notebook.cells[2]!.source, "top = sales.head(TOP_N)", "print(top)"]);
  });
});

describe("a deleted notebook's steps leave its flow (ADR-0041)", () => {
  const flow = synced(pipeline);

  it("drops the notebook's steps and every edge into or between them, and keeps the rest", () => {
    const base = { ...flow, edges: [...flow.edges, { from: "load.data", to: "sales_2.data" }] };
    const done = stepsOutOfFlow(base, NB);
    if (!("version" in done)) throw new Error(JSON.stringify(done));
    expect(parse("PipelineVersion", done.version).parent_id).toBe(base.id);
    expect(done.version.nodes).toEqual(pipeline.nodes);
    expect(done.version.edges).toEqual(pipeline.edges);
  });

  it("refuses, naming each step outside the notebook that reads one of its outputs", () => {
    const base: PipelineVersion = {
      ...flow,
      nodes: [...flow.nodes, { id: "report", operator: "sprisk.code.python@2.0.0", params: { source: "", inputs: ["sales"] } }],
      edges: [...flow.edges, { from: "sales_2.sales", to: "report.sales" }, { from: "sales_3.sales", to: "report.top" }],
    };
    expect(stepsOutOfFlow(base, NB)).toEqual({ refused: ["report"] });
  });

  it("has nothing to change when the flow holds none of the notebook's steps", () => {
    expect(stepsOutOfFlow(pipeline, NB)).toEqual({ unchanged: true });
  });
});
