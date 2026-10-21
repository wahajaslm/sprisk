import type { PipelineVersion } from "@sprisk/contracts";
import { describe, expect, it } from "vitest";

import { newStepsIn, stageCells, stageEdits } from "../src/notebook/stageCells.ts";
import { notebookOperator, operators, pipeline } from "./fixtures.ts";

const byRef = new Map([...operators, notebookOperator].map((o) => [o.id, o]));

/** The fixture flow with a code step in Clean, after impute, and notes around the split. */
const flow: PipelineVersion = {
  ...pipeline,
  nodes: [
    ...pipeline.nodes.map((n) => (n.id === "split" ? { ...n, notes: { before: ["## Hold out a quarter"], after: ["Test rows stay unread."] } } : n)),
    { id: "rate", operator: notebookOperator.id, params: { source: "rate = impute_train.height", inputs: ["impute_train"], outputs: [] } },
  ],
  edges: [...pipeline.edges, { from: "impute.train", to: "rate.impute_train" }],
};

describe("a stage's cells (ADR-0055)", () => {
  it("are its notes as Markdown and its steps as code cells named by the step", () => {
    expect(stageCells(flow, byRef, "Split")).toEqual([
      { id: "split-before-0", kind: "markdown", source: "## Hold out a quarter" },
      { id: "split", kind: "code", source: "" },
      { id: "split-after-0", kind: "markdown", source: "Test rows stay unread." },
    ]);
    expect(stageCells(flow, byRef, "Clean")).toEqual([
      { id: "impute", kind: "code", source: "" },
      { id: "rate", kind: "code", source: "rate = impute_train.height" },
    ]);
  });

  it("show a ready-made step as its plain Python when it has some", () => {
    const code = new Map([["split", "split_train, split_test = cut(load_data)\n"]]);
    expect(stageCells(flow, byRef, "Split", code)[1]).toEqual({ id: "split", kind: "code", source: "split_train, split_test = cut(load_data)\n" });
  });
});

describe("editing a ready-made step's plain Python", () => {
  const code = new Map([["split", "split_train, split_test = cut(load_data)\n"]]);

  it("makes it a code step with that code, whose outputs still reach the steps that read them", () => {
    const cells = stageCells(flow, byRef, "Split", code).map((c) => (c.id === "split" ? { ...c, source: "split_train, split_test = cut(load_data, 0.3)\n" } : c));
    const done = stageEdits(flow, byRef, "Split", cells, code);
    if ("refused" in done) throw new Error(done.refused);
    const split = done.base.nodes.find((n) => n.id === "split")!;
    expect(split.operator).toBe(notebookOperator.id);
    expect(done.steps.find((s) => s.nodeId === "split")).toEqual({ kind: "cells", nodeId: "split", cells: ["split_train, split_test = cut(load_data, 0.3)"] });
    expect(done.base.edges).toContainEqual({ from: "split.split_train", to: "impute.train" });
    expect(done.base.edges.some((e) => e.to === "split.data")).toBe(false);
  });

  it("leaves an unedited one as the ready-made step", () => {
    const done = stageEdits(flow, byRef, "Split", stageCells(flow, byRef, "Split", code), code);
    if ("refused" in done) throw new Error(done.refused);
    expect(done.base.nodes.find((n) => n.id === "split")?.operator).toBe("sprisk.validation.random_split@1.0.0");
  });
});

describe("saving a stage's cells", () => {
  it("puts edited code into its step", () => {
    const cells = stageCells(flow, byRef, "Clean").map((c) => (c.id === "rate" ? { ...c, source: "rate = impute_train.height * 2" } : c));
    const done = stageEdits(flow, byRef, "Clean", cells);
    if ("refused" in done) throw new Error(done.refused);
    const step = done.steps.find((s) => s.nodeId === "rate");
    expect(step).toEqual({ kind: "cells", nodeId: "rate", cells: ["rate = impute_train.height * 2"] });
  });

  it("puts a new code cell right after the step above it", () => {
    const cells = [...stageCells(flow, byRef, "Clean").slice(0, 1), { id: "new1", kind: "code" as const, source: "n = len(impute_train)" }, ...stageCells(flow, byRef, "Clean").slice(1)];
    const done = stageEdits(flow, byRef, "Clean", cells);
    if ("refused" in done) throw new Error(done.refused);
    const at = done.steps.findIndex((s) => s.nodeId === "impute");
    expect(done.steps[at + 1]).toEqual({ kind: "cells", nodeId: undefined, cells: ["n = len(impute_train)"] });
  });

  it("keeps Markdown with the step below it, and after the last step", () => {
    const cells = [
      { id: "x", kind: "markdown" as const, source: "Split by applicant." },
      { id: "split", kind: "code" as const, source: "" },
      { id: "y", kind: "markdown" as const, source: "Done." },
    ];
    const done = stageEdits(flow, byRef, "Split", cells);
    if ("refused" in done) throw new Error(done.refused);
    expect(done.base.nodes.find((n) => n.id === "split")?.notes).toEqual({ before: ["Split by applicant."], after: ["Done."] });
  });

  it("refuses Markdown in a stage with no step to keep it", () => {
    expect(stageEdits(flow, byRef, "Explore", [{ id: "x", kind: "markdown", source: "Notes" }])).toEqual({ refused: "Text in Explore needs a step in the same notebook to stay with." });
  });

  it("places steps the save made in this stage", () => {
    const made: PipelineVersion = { ...flow, nodes: [...flow.nodes, { id: "nb_1", operator: notebookOperator.id, params: { source: "n = 1", inputs: [], outputs: [] } }] };
    expect(newStepsIn(made, flow, "Clean").nodes.find((n) => n.id === "nb_1")?.stage).toBe("clean");
    expect(newStepsIn(made, flow, "Clean").nodes.find((n) => n.id === "rate")?.stage).toBeUndefined();
  });
});
