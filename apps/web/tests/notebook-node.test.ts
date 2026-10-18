import type { CodeSplit, PipelineVersion } from "@sprisk/contracts";
import { parse } from "@sprisk/contracts";
import { describe, expect, it } from "vitest";

import type { Ran } from "../src/notebook/outputs.ts";
import { addNode, bindInputs, proposeNode, type Proposal, sessionWarnings } from "../src/notebook/node.ts";
import { pipeline } from "./fixtures.ts";

const FROM = { notebook_version_id: "nbv_01JAAAAAAAAAAAAAAAAAAAAAAB", cells: ["c2", "c3"] };
const PROJECT = "prj_00000000000000000000000000";

/** Cells: 0 loads `customers`, 1–2 are picked and make `eligible`, 3 reads it. */
const split: CodeSplit = {
  steps: [
    { source: "customers = load()", cells: [0], parameters: [], inputs: [], outputs: ["customers"] },
    {
      source: "minimum_age = 18\neligible = customers[customers.age >= minimum_age]",
      cells: [1, 2],
      parameters: [{ name: "minimum_age", value: 18 }],
      inputs: ["customers"],
      outputs: ["eligible"],
    },
    { source: "eligible.describe()", cells: [3], parameters: [], inputs: ["eligible"], outputs: [] },
  ],
  links: [
    { from_step: 0, to_step: 1, name: "customers" },
    { from_step: 1, to_step: 2, name: "eligible" },
  ],
  notes: [],
};

const number = (i: number) => i + 1;

const proposal = (): Proposal => {
  const found = proposeNode(split, 1, 2, number);
  if ("refused" in found) throw new Error(found.refused);
  return found.proposal;
};

describe("Create node from cells (ADR-0036)", () => {
  it("proposes the picked cells' inputs, parameters and outputs", () => {
    expect(proposal()).toEqual({
      source: split.steps[1]!.source,
      inputs: ["customers"],
      parameters: [{ name: "minimum_age", value: 18 }],
      outputs: ["eligible"],
      notes: [],
    });
  });

  it("refuses when the analyzer had to pull other cells into the node, naming them and why", () => {
    const merged: CodeSplit = {
      ...split,
      steps: [{ ...split.steps[1]!, cells: [0, 1, 2] }],
      notes: [{ cell: 0, message: "clean is a function or class from cell 1; cells 1–3 stay in one step" }],
    };
    const found = proposeNode(merged, 1, 2, number);
    expect(found).toEqual({
      refused: "Cell 1 must be in this node too: clean is a function or class from cell 1; cells 1–3 stay in one step. Pick it as well.",
    });
  });

  it("refuses picked cells that hold no code to run", () => {
    expect(proposeNode({ steps: [], links: [], notes: [] }, 0, 0, number)).toEqual({ refused: "The picked cells only import or define nothing to run." });
  });

  it("adds the node to a flow, linking each input to the step that makes it", () => {
    const flow: PipelineVersion = {
      ...pipeline,
      nodes: [...pipeline.nodes, { id: "customers", operator: "sprisk.code.python@2.0.0", params: { source: "customers = load()", outputs: ["customers"] } }],
    };
    const done = addNode({ base: flow, projectId: PROJECT, proposal: proposal(), nodeId: "eligible", outputs: ["eligible"], parameters: ["minimum_age"], from: FROM });
    if ("refused" in done) throw new Error(done.refused);
    expect(parse("PipelineVersion", done.version).parent_id).toBe(flow.id);
    expect(done.version.nodes.at(-1)).toEqual({
      id: "eligible",
      operator: "sprisk.code.python@2.0.0",
      params: { source: split.steps[1]!.source, inputs: ["customers"], outputs: ["eligible"], parameters: { minimum_age: 18 } },
      from_notebook: FROM,
    });
    expect(done.version.edges.at(-1)).toEqual({ from: "customers.customers", to: "eligible.customers" });
  });

  it("never links an input to a built-in step by its name, which could be a holdout", () => {
    expect(bindInputs(pipeline, ["split_test"])).toEqual({
      refused: "No step in this flow makes split_test. Pick the cells that make it too, or create their node first.",
    });
  });

  it("refuses an input two steps make, rather than guess which one the session used", () => {
    const twice: PipelineVersion = {
      ...pipeline,
      nodes: [
        { id: "a", operator: "sprisk.code.python@2.0.0", params: { source: "df = 1", outputs: ["df"] } },
        { id: "b", operator: "sprisk.code.python@2.0.0", params: { source: "df = 2", outputs: ["df"] } },
      ],
    };
    expect(bindInputs(twice, ["df"])).toEqual({ refused: "Steps a and b both make df. Rename one, or pick the cells that make it too." });
  });

  it("keeps the analyzer's notes about the picked cells", () => {
    const noted: CodeSplit = { ...split, notes: [{ cell: 2, message: "cell 3 reads lookup, which no earlier cell sets" }, { cell: 3, message: "other" }] };
    const found = proposeNode(noted, 1, 2, number);
    if ("refused" in found) throw new Error(found.refused);
    expect(found.proposal.notes).toEqual(["cell 3 reads lookup, which no earlier cell sets"]);
  });

  it("refuses an input no step of the flow makes", () => {
    const done = addNode({ base: pipeline, projectId: PROJECT, proposal: proposal(), nodeId: "eligible", outputs: ["eligible"], parameters: [], from: FROM });
    expect(done).toEqual({
      refused: "No step in this flow makes customers. Pick the cells that make it too, or create their node first.",
    });
  });

  it("starts a new flow when there is none and the node reads nothing", () => {
    const alone = { ...proposal(), inputs: [] };
    const done = addNode({ base: undefined, projectId: PROJECT, proposal: alone, nodeId: "eligible", outputs: ["eligible"], parameters: [], from: FROM });
    if ("refused" in done) throw new Error(done.refused);
    expect(parse("PipelineVersion", done.version).parent_id).toBeUndefined();
    expect(done.version.nodes).toHaveLength(1);
  });

  it("refuses a node id the flow already uses or that is not a valid name", () => {
    const base = { base: pipeline, projectId: PROJECT, proposal: { ...proposal(), inputs: [] }, outputs: [], parameters: [], from: FROM };
    expect(addNode({ ...base, nodeId: "load" })).toEqual({ refused: "This flow already has a step named load." });
    expect(addNode({ ...base, nodeId: "Bad Name" })).toEqual({
      refused: "Bad Name is not a step name: use lowercase letters, digits and _, starting with a letter.",
    });
  });
});

describe("what the session ran, against what the node will run", () => {
  const cells = [
    { id: "a", kind: "code" as const, source: "x = 1" },
    { id: "b", kind: "code" as const, source: "y = x + 1" },
    { id: "c", kind: "code" as const, source: "z = y" },
  ];
  const ran = (code: string, n: number): Ran => ({ code, result: { status: "ok", execution_count: n, outputs: [] } });

  it("says which picked cells never ran or changed since they ran", () => {
    const warnings = sessionWarnings(cells, 1, 2, { a: ran("x = 1", 1), b: ran("y = x", 2) }, number);
    expect(warnings).toEqual(["Cell 2 changed since it ran.", "Cell 3 has not run in this session."]);
  });

  it("says when cells ran out of order", () => {
    const warnings = sessionWarnings(cells, 0, 0, { a: ran("x = 1", 3), b: ran("y = x + 1", 2) }, number);
    expect(warnings).toEqual(["Cells ran out of order: the session's values may come from cells below the ones they read."]);
  });

  it("has nothing to say when the cells ran top to bottom as they read now", () => {
    expect(sessionWarnings(cells, 0, 1, { a: ran("x = 1", 1), b: ran("y = x + 1", 2) }, number)).toEqual([]);
  });
});
