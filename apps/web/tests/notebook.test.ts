import type { CodeSplit } from "@sprisk/contracts";
import { describe, expect, it } from "vitest";

import { cellsFromFile, flowFromSplit, NOTEBOOK_OPERATOR } from "../src/flow/notebook.ts";

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
      { source: "df = load()", cells: [0], inputs: [], outputs: ["df"] },
      { source: "n = len(df)", cells: [1, 2], inputs: ["df"], outputs: [] },
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
