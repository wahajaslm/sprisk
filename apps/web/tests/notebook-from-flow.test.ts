import type { CodeSplit, NotebookVersion, OperatorSource } from "@sprisk/contracts";
import { describe, expect, it } from "vitest";

import { flowNotebooks } from "../src/notebook/fromFlow.ts";
import { stepsIntoFlow } from "../src/notebook/sync.ts";
import { operators, pipeline } from "./fixtures.ts";

const byRef = new Map(operators.map((o) => [o.id, o]));
const source = (operator: string): OperatorSource => ({
  operator,
  path: "m.py",
  language: "python",
  text: `def f(**kwargs):\n    """${operator}"""\n`,
  digest: `sha256:${"0".repeat(64)}`,
});
const sources = new Map(operators.map((o) => [o.id, source(o.id)]));
const cells = flowNotebooks(pipeline, byRef, sources).flatMap((n) => n.cells);

describe("a flow's notebook (ADR-0054)", () => {
  it("gives a built-in step a heading, its operator's source to read and a call that runs", () => {
    const at = cells.findIndex((c) => c.source.startsWith("### Stage Step: `model`"));
    const [heading, code, call] = cells.slice(at, at + 3);
    expect(heading).toEqual({ id: expect.any(String), kind: "markdown", source: "### Stage Step: `model`" });
    expect(code).toMatchObject({ kind: "markdown" });
    expect(code!.source).toBe(`Code of \`sprisk.ml.linear_model@1.0.0\` (m.py):\n\n\`\`\`python\n${source("sprisk.ml.linear_model@1.0.0").text}\`\`\``);
    expect(call).toMatchObject({ kind: "code" });
    expect(call!.source.split("\n")[0]).toBe("from m import f as model");
    expect(call!.source).toContain("model_model = model(train=impute_train");
  });

  it("imports Path where a step reads a local file", () => {
    const load = cells.find((c) => c.kind === "code" && c.source.includes("load_data = load("));
    expect(load!.source.split("\n").slice(0, 2)).toEqual(["from pathlib import Path", "from m import f as load"]);
  });

  it("adds no step and drops none when saved, since each call is its built-in step", () => {
    const code = cells.filter((c) => c.kind === "code");
    const notebook: NotebookVersion = {
      schema_version: "sprisk.notebook_version/v1",
      id: "nbv_01JAAAAAAAAAAAAAAAAAAAAAAB",
      notebook_id: "nb_01JAAAAAAAAAAAAAAAAAAAAAAA",
      project_id: pipeline.project_id,
      title: "flow",
      cells,
      created_at: "2026-10-21T10:00:00Z",
    };
    // As Python reads them: each call cell is a step of its own.
    const split: CodeSplit = {
      steps: code.map((c, i) => ({ source: c.source, cells: [i], parameters: [], inputs: [], outputs: [] })),
      links: [],
      notes: [],
    };
    expect(stepsIntoFlow({ base: pipeline, projectId: pipeline.project_id, notebook, split, previous: notebook })).toEqual({ unchanged: true });
  });
});

describe("a person's cell beside the flow's calls", () => {
  it("reads a built-in step's output by the name its call wrote", () => {
    const callCells = flowNotebooks(pipeline, byRef, sources).flatMap((n) => n.cells);
    const mine = { id: "mine", kind: "code" as const, source: "rows = len(split_train)" };
    const all = [...callCells, mine];
    const code = all.filter((c) => c.kind === "code");
    const splitAt = code.findIndex((c) => c.source.includes("split_out = split("));
    const notebook: NotebookVersion = {
      schema_version: "sprisk.notebook_version/v1",
      id: "nbv_01JAAAAAAAAAAAAAAAAAAAAAAC",
      notebook_id: "nb_01JAAAAAAAAAAAAAAAAAAAAAAA",
      project_id: pipeline.project_id,
      title: "flow",
      cells: all,
      created_at: "2026-10-21T10:00:00Z",
    };
    const split: CodeSplit = {
      steps: code.map((c, i) => ({ source: c.source, cells: [i], parameters: [], inputs: c.id === "mine" ? ["split_train"] : [], outputs: [] })),
      links: [{ from_step: splitAt, to_step: code.length - 1, name: "split_train" }],
      notes: [],
    };
    const done = stepsIntoFlow({ base: pipeline, projectId: pipeline.project_id, notebook, split, previous: notebook });
    if (!("version" in done)) throw new Error(JSON.stringify(done));
    const added = done.version.nodes.filter((n) => !pipeline.nodes.some((p) => p.id === n.id));
    expect(added).toHaveLength(1);
    expect(done.version.edges).toContainEqual({ from: "split.train", to: `${added[0]!.id}.split_train` });
  });
});
