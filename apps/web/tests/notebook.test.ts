import type { CodeSplit, PipelineVersion } from "@sprisk/contracts";
import { describe, expect, it } from "vitest";

import {
  cellNumber,
  cellsFromFile,
  flowFromSplit,
  NOTEBOOK_OPERATOR,
  notebookOrder,
  notebookSteps,
  type NotebookStep,
  splitRequest,
  toIpynb,
  versionFromSplit,
  withCell,
  withNewCell,
  withoutCell,
  withSource,
} from "../src/flow/notebook.ts";
import { codePipeline, notebookOperator, operators, pipeline } from "./fixtures.ts";

describe("reading notebook cells (ADR-0031)", () => {
  it("takes the code cells of a .ipynb, joining each cell's lines", () => {
    const notebook = JSON.stringify({
      nbformat: 4,
      cells: [
        { cell_type: "markdown", source: ["# Title"] },
        { cell_type: "code", source: ["import pandas as pd\n", "df = pd.read_csv('a.csv')"], outputs: [] },
        { cell_type: "code", source: "df.head()", outputs: [] },
      ],
    });
    expect(cellsFromFile("analysis.ipynb", notebook)).toEqual(["import pandas as pd\ndf = pd.read_csv('a.csv')", "df.head()"]);
  });

  it("says plainly when a .ipynb is not a notebook", () => {
    expect(() => cellsFromFile("x.ipynb", "{}")).toThrow("x.ipynb is not a Jupyter notebook: it has no cells");
    expect(() => cellsFromFile("x.ipynb", "not json")).toThrow(/x.ipynb is not a Jupyter notebook/);
  });

  it("splits pasted code on # %% markers, or keeps it as one cell", () => {
    expect(cellsFromFile("cells.py", "# %%\na = 1\n# %% Filter\nb = a\n")).toEqual(["a = 1", "b = a"]);
    expect(cellsFromFile("pasted", "a = 1\nb = a")).toEqual(["a = 1\nb = a"]);
  });
});

describe("a flow from split cells", () => {
  const split: CodeSplit = {
    steps: [
      { source: "df = load()", cells: [0], parameters: [], inputs: [], outputs: ["df"] },
      { source: "n = len(df)", cells: [1, 2], parameters: [], inputs: ["df"], outputs: [] },
    ],
    links: [{ from_step: 0, to_step: 1, name: "df" }],
    notes: [],
  };

  it("makes one code step per split step, linked by name, as a new flow", () => {
    const version = flowFromSplit(split, "prj_00000000000000000000000000");
    expect(version.parent_id).toBeUndefined();
    expect(version.project_id).toBe("prj_00000000000000000000000000");
    expect(version.nodes).toEqual([
      { id: "cell_1", operator: NOTEBOOK_OPERATOR, params: { source: "df = load()", outputs: ["df"] } },
      { id: "cell_2", operator: NOTEBOOK_OPERATOR, params: { source: "n = len(df)", inputs: ["df"] } },
    ]);
    expect(version.edges).toEqual([{ from: "cell_1.df", to: "cell_2.df" }]);
  });
});

const ops = new Map([...operators, notebookOperator].map((o) => [o.id, o]));

/** load (built-in) → two cells kept in one code step → split (built-in) → one code cell. */
const mixed: PipelineVersion = {
  ...pipeline,
  nodes: [
    { id: "load", operator: "sprisk.io.file_source@1.0.0", params: { path: "/d/iris.csv", format: "csv" } },
    {
      id: "cell_1",
      operator: NOTEBOOK_OPERATOR,
      params: { source: "def tidy(t):\n    return t.drop_nulls()\n\n# %%\nclean = tidy(df)", parameters: [], inputs: ["df"], outputs: ["clean"] },
    },
    { id: "split", operator: "sprisk.validation.random_split@1.0.0", params: { seed: 42 } },
    { id: "cell_2", operator: NOTEBOOK_OPERATOR, params: { source: "n = train.height", inputs: ["train"] } },
  ],
  edges: [
    { from: "load.data", to: "cell_1.df" },
    { from: "cell_1.clean", to: "split.data" },
    { from: "split.train", to: "cell_2.train" },
  ],
};

const LOAD_CALL = 'load_data = df = f(path=Path("/d/iris.csv"), format="csv")';
const SPLIT_CALL = 'split_out = f(data=clean, seed=42)\nsplit_train = train = split_out["train"]\nsplit_test = split_out["test"]';
const byEnds = (edges: PipelineVersion["edges"]) => [...edges].sort((a, b) => `${a.from}>${a.to}`.localeCompare(`${b.from}>${b.to}`));

describe("notebook order (ADR-0033)", () => {
  it("keeps the saved order when each step comes after what it reads", () => {
    expect(notebookOrder(pipeline).map((n) => n.id)).toEqual(["load", "profile", "split", "impute", "model", "score"]);
  });

  it("moves a step after the steps it reads", () => {
    const reversed = { ...pipeline, nodes: [...pipeline.nodes].reverse() };
    expect(notebookOrder(reversed).map((n) => n.id)).toEqual(["load", "split", "impute", "model", "score", "profile"]);
  });
});

describe("a flow as notebook cells", () => {
  it("shows a code step's cells, and a built-in step as its call", () => {
    expect(notebookSteps(mixed, ops)).toEqual([
      { kind: "builtin", nodeId: "load", call: LOAD_CALL },
      { kind: "cells", nodeId: "cell_1", cells: ["def tidy(t):\n    return t.drop_nulls()", "clean = tidy(df)"] },
      { kind: "builtin", nodeId: "split", call: SPLIT_CALL },
      { kind: "cells", nodeId: "cell_2", cells: ["n = train.height"] },
    ]);
  });

  it("shows a step whose operator is not installed as a comment, not as code", () => {
    const missing = { ...pipeline, nodes: [{ id: "old", operator: "sprisk.io.gone@1.0.0", params: {} }], edges: [] };
    expect(notebookSteps(missing, ops)).toEqual([{ kind: "builtin", nodeId: "old", call: "# operator sprisk.io.gone@1.0.0 is not installed" }]);
  });

  it("shows a v1 code step's code and the table it gets as data", () => {
    const steps = notebookSteps(codePipeline, ops);
    expect(steps.at(-1)).toEqual({ kind: "code", nodeId: "code_1", source: "print(data.height)\ndata.head(1)", data: "load_data" });
  });
});

describe("edited cells become the next version", () => {
  const steps = notebookSteps(mixed, ops);
  const request = splitRequest(mixed, ops, steps);
  // What Python returns for the unchanged cells (POST /code/split).
  const unchanged: CodeSplit = {
    steps: [
      { cells: [0], source: "load_data = df = object()", parameters: [], inputs: [], outputs: ["df"] },
      { cells: [1, 2], source: "def tidy(t):\n    return t.drop_nulls()\n\n# %%\nclean = tidy(df)", parameters: [], inputs: ["df"], outputs: ["clean"] },
      { cells: [3], source: "split_train = train = split_test = object(clean)", parameters: [], inputs: ["clean"], outputs: ["train"] },
      { cells: [4], source: "n = train.height", parameters: [], inputs: ["train"], outputs: [] },
    ],
    links: [
      { from_step: 0, to_step: 1, name: "df" },
      { from_step: 1, to_step: 2, name: "clean" },
      { from_step: 2, to_step: 3, name: "train" },
    ],
    notes: [],
  };

  it("sends every cell in order, a built-in step as a line that reads and sets its names", () => {
    expect(request.cells).toEqual([
      "load_data = df = object()",
      "def tidy(t):\n    return t.drop_nulls()",
      "clean = tidy(df)",
      "split_train = train = split_test = object(clean)",
      "n = train.height",
    ]);
  });

  it("gives back the same steps and links when nothing changed", () => {
    const { version, cellNodes } = versionFromSplit(mixed, ops, request, unchanged);
    expect(cellNodes).toEqual(["load", "cell_1", "cell_1", "split", "cell_2"]);
    expect(version.parent_id).toBe(mixed.id);
    expect(version.id).not.toBe(mixed.id);
    expect(version.nodes).toEqual(mixed.nodes);
    expect(byEnds(version.edges)).toEqual(byEnds(mixed.edges));
  });

  it("adds a step for a new cell, linked to the built-in output it reads", () => {
    const added: NotebookStep[] = [...steps, { kind: "cells", nodeId: undefined, cells: ["m = split_test.height"] }];
    const req = splitRequest(mixed, ops, added);
    const split: CodeSplit = {
      steps: [
        ...unchanged.steps.slice(0, 2),
        { ...unchanged.steps[2]!, outputs: ["train", "split_test"] },
        unchanged.steps[3]!,
        { cells: [5], source: "m = split_test.height", parameters: [], inputs: ["split_test"], outputs: [] },
      ],
      links: [...unchanged.links, { from_step: 2, to_step: 4, name: "split_test" }],
      notes: [],
    };
    const { version } = versionFromSplit(mixed, ops, req, split);
    expect(version.nodes.at(-1)).toEqual({ id: "cell_3", operator: NOTEBOOK_OPERATOR, params: { source: "m = split_test.height", inputs: ["split_test"] } });
    expect(version.edges).toContainEqual({ from: "split.test", to: "cell_3.split_test" });
  });

  it("keeps cells that must run together in the first one's step", () => {
    const cells: PipelineVersion = {
      ...pipeline,
      nodes: [
        { id: "cell_1", operator: NOTEBOOK_OPERATOR, params: { source: "a = load()", outputs: ["a"] } },
        { id: "cell_2", operator: NOTEBOOK_OPERATOR, params: { source: "b = a + 1", inputs: ["a"] } },
      ],
      edges: [{ from: "cell_1.a", to: "cell_2.a" }],
    };
    const edited: NotebookStep[] = [
      { kind: "cells", nodeId: "cell_1", cells: ["def f(x):\n    return x\na = load()"] },
      { kind: "cells", nodeId: "cell_2", cells: ["b = f(a)"] },
    ];
    const source = "def f(x):\n    return x\na = load()\n\n# %%\nb = f(a)";
    const split: CodeSplit = {
      steps: [{ cells: [0, 1], source, parameters: [], inputs: [], outputs: [] }],
      links: [],
      notes: [{ cell: 1, message: "f is a function or class from cell 1; cells 1–2 stay in one step" }],
    };
    const { version, notes } = versionFromSplit(cells, ops, splitRequest(cells, ops, edited), split);
    expect(version.nodes).toEqual([{ id: "cell_1", operator: NOTEBOOK_OPERATOR, params: { source } }]);
    expect(version.edges).toEqual([]);
    expect(notes).toEqual(["f is a function or class from cell 1; cells 1–2 stay in one step"]);
  });

  it("refuses cells that must run together across a built-in step", () => {
    const split: CodeSplit = {
      steps: [unchanged.steps[0]!, { cells: [1, 2, 3, 4], source: "…", parameters: [], inputs: ["df"], outputs: [] }],
      links: [{ from_step: 0, to_step: 1, name: "df" }],
      notes: [{ cell: 4, message: "tidy is a function or class from cell 2; cells 2–5 stay in one step" }],
    };
    expect(() => versionFromSplit(mixed, ops, request, split)).toThrow(
      "tidy is a function or class from cell 2; cells 2–5 stay in one step, but built-in step split sits between them. Move those cells next to each other.",
    );
  });

  it("refuses a name that stands for two built-in outputs, before anything is sent", () => {
    const twice: PipelineVersion = {
      ...pipeline,
      nodes: [
        { id: "a", operator: "sprisk.io.file_source@1.0.0", params: {} },
        { id: "b", operator: "sprisk.io.file_source@1.0.0", params: {} },
        { id: "cell_1", operator: NOTEBOOK_OPERATOR, params: { source: "x = df.height", inputs: ["df"] } },
        { id: "cell_2", operator: NOTEBOOK_OPERATOR, params: { source: "y = df.width", inputs: ["df"] } },
      ],
      edges: [
        { from: "a.data", to: "cell_1.df" },
        { from: "b.data", to: "cell_2.df" },
      ],
    };
    expect(() => splitRequest(twice, ops, notebookSteps(twice, ops))).toThrow(
      "df names both a.data and b.data. Rename it in one of the cells that read it.",
    );
  });

  it("refuses an edit that leaves a built-in step without an input", () => {
    const renamed: CodeSplit = {
      ...unchanged,
      steps: [unchanged.steps[0]!, { ...unchanged.steps[1]!, outputs: [] }, { ...unchanged.steps[2]!, inputs: [] }, unchanged.steps[3]!],
      links: [unchanged.links[0]!, unchanged.links[2]!],
    };
    expect(() => versionFromSplit(mixed, ops, request, renamed)).toThrow("step split reads clean, which no cell sets now");
  });

  it("says when Python's reply names cells or steps that do not exist", () => {
    const badCell = { ...unchanged, steps: [...unchanged.steps, { cells: [9], source: "", parameters: [], inputs: [], outputs: [] }] };
    expect(() => versionFromSplit(mixed, ops, request, badCell)).toThrow("the split names cell 9, which was not sent");
    const badLink = { ...unchanged, links: [...unchanged.links, { from_step: 7, to_step: 3, name: "x" }] };
    expect(() => versionFromSplit(mixed, ops, request, badLink)).toThrow("the split links step 7, which it did not return");
  });

  it("drops the analyzer's notes about built-in steps' stand-in lines", () => {
    const split = { ...unchanged, notes: [{ cell: 0, message: "cell 1 reads x" }, { cell: 4, message: "cell 5 reads y, which no earlier cell sets" }] };
    expect(versionFromSplit(mixed, ops, request, split).notes).toEqual(["cell 5 reads y, which no earlier cell sets"]);
  });
});

describe("editing the notebook's cells", () => {
  const steps = notebookSteps(mixed, ops);

  it("changes one cell of a step", () => {
    expect(withCell(steps, { step: 1, cell: 1 }, "clean = df")[1]).toEqual({ kind: "cells", nodeId: "cell_1", cells: ["def tidy(t):\n    return t.drop_nulls()", "clean = df"] });
  });

  it("adds an empty cell as a new step after a step", () => {
    const added = withNewCell(steps, 0);
    expect(added).toHaveLength(5);
    expect(added[1]).toEqual({ kind: "cells", nodeId: undefined, cells: [""] });
  });

  it("removes a cell, and the step with its last cell", () => {
    expect(withoutCell(steps, { step: 1, cell: 0 })[1]).toEqual({ kind: "cells", nodeId: "cell_1", cells: ["clean = tidy(df)"] });
    expect(withoutCell(steps, { step: 3, cell: 0 }).map((s) => s.nodeId)).toEqual(["load", "cell_1", "split"]);
  });

  it("numbers cells across the notebook, a built-in step counting as one", () => {
    expect(cellNumber(steps, { step: 1, cell: 1 })).toBe(2);
    expect(cellNumber(steps, { step: 3, cell: 0 })).toBe(4);
  });

  it("replaces a code step's cells from its whole source", () => {
    expect(withSource(steps, "cell_2", "a = 1\n# %%\nb = a")[3]).toEqual({ kind: "cells", nodeId: "cell_2", cells: ["a = 1", "b = a"] });
  });
});

describe("download as .ipynb", () => {
  const sources = new Map([
    ["sprisk.io.file_source@1.0.0", "def f(path, format):\n    ..."],
    ["sprisk.validation.random_split@1.0.0", "def f(data, seed):\n    ..."],
  ]);

  it("writes each cell, and a built-in step as its code plus its call", () => {
    const notebook = toIpynb(mixed, ops, sources);
    expect(notebook.nbformat).toBe(4);
    expect(cellsFromFile("flow.ipynb", JSON.stringify(notebook))).toEqual([
      `def f(path, format):\n    ...\n\nfrom pathlib import Path\n\n${LOAD_CALL}`,
      "def tidy(t):\n    return t.drop_nulls()",
      "clean = tidy(df)",
      `def f(data, seed):\n    ...\n\n${SPLIT_CALL}`,
      "n = train.height",
    ]);
  });

  it("writes a built-in operator's code once, and a step's own code where it has it", () => {
    const twice: PipelineVersion = {
      ...pipeline,
      nodes: [
        { id: "a", operator: "sprisk.io.file_source@1.0.0", params: {} },
        { id: "b", operator: "sprisk.io.file_source@1.0.0", params: {} },
        { id: "c", operator: "sprisk.io.file_source@1.0.0", params: {}, code: { source: "def g():\n    ...", function: "g" } },
      ],
      edges: [],
    };
    expect(cellsFromFile("flow.ipynb", JSON.stringify(toIpynb(twice, ops, sources)))).toEqual([
      "def f(path, format):\n    ...\n\na_data = f()",
      "b_data = f()",
      "def g():\n    ...\n\nc_data = g()",
    ]);
  });

  it("gives a v1 code step its input as data, with polars", () => {
    const cells = cellsFromFile("flow.ipynb", JSON.stringify(toIpynb(codePipeline, ops, new Map(operators.map((o) => [o.id, "..."])))));
    expect(cells[0]).toBe("import polars as pl");
    expect(cells.at(-1)).toBe("data = load_data\nprint(data.height)\ndata.head(1)\ncode_1_data = data");
  });

  it("says which operator's code is missing", () => {
    expect(() => toIpynb(mixed, ops, new Map())).toThrow("code of sprisk.io.file_source@1.0.0 is not loaded");
  });
});
