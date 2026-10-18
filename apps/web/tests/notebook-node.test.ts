import type { CodeSplit, Operator, PipelineVersion } from "@sprisk/contracts";
import { parse } from "@sprisk/contracts";
import { describe, expect, it } from "vitest";

import { addNode, proposeNode, type Proposal } from "../src/notebook/node.ts";
import { notebookOperator, operators, pipeline } from "./fixtures.ts";

const ops = new Map<string, Operator>([...operators, notebookOperator].map((op) => [op.id, op]));
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

const proposal = (): Proposal => {
  const found = proposeNode(split, 1, 2);
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
    });
  });

  it("refuses when the analyzer had to pull other cells into the node, naming them and why", () => {
    const merged: CodeSplit = {
      ...split,
      steps: [{ ...split.steps[1]!, cells: [0, 1, 2] }],
      notes: [{ cell: 0, message: "clean is a function or class from cell 1; cells 1–3 stay in one step" }],
    };
    const found = proposeNode(merged, 1, 2);
    expect(found).toEqual({
      refused: "Cell 1 must be in this node too: clean is a function or class from cell 1; cells 1–3 stay in one step. Pick it as well.",
    });
  });

  it("refuses picked cells that hold no code to run", () => {
    expect(proposeNode({ steps: [], links: [], notes: [] }, 0, 0)).toEqual({ refused: "The picked cells only import or define nothing to run." });
  });

  it("adds the node to a flow, linking each input to the step that makes it", () => {
    const flow: PipelineVersion = {
      ...pipeline,
      nodes: [...pipeline.nodes, { id: "customers", operator: "sprisk.code.python@2.0.0", params: { source: "customers = load()", outputs: ["customers"] } }],
    };
    const done = addNode({ base: flow, projectId: PROJECT, operators: ops, proposal: proposal(), nodeId: "eligible", outputs: ["eligible"], parameters: ["minimum_age"], from: FROM });
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

  it("links an input named after a built-in step's output, as the notebook names them", () => {
    const reads = { ...proposal(), inputs: ["split_train"] };
    const done = addNode({ base: pipeline, projectId: PROJECT, operators: ops, proposal: reads, nodeId: "eligible", outputs: [], parameters: [], from: FROM });
    if ("refused" in done) throw new Error(done.refused);
    expect(done.version.edges.at(-1)).toEqual({ from: "split.train", to: "eligible.split_train" });
  });

  it("refuses an input no step of the flow makes", () => {
    const done = addNode({ base: pipeline, projectId: PROJECT, operators: ops, proposal: proposal(), nodeId: "eligible", outputs: ["eligible"], parameters: [], from: FROM });
    expect(done).toEqual({
      refused: "No step in this flow makes customers. Pick the cells that make it too, or create their node first.",
    });
  });

  it("starts a new flow when there is none and the node reads nothing", () => {
    const alone = { ...proposal(), inputs: [] };
    const done = addNode({ base: undefined, projectId: PROJECT, operators: ops, proposal: alone, nodeId: "eligible", outputs: ["eligible"], parameters: [], from: FROM });
    if ("refused" in done) throw new Error(done.refused);
    expect(parse("PipelineVersion", done.version).parent_id).toBeUndefined();
    expect(done.version.nodes).toHaveLength(1);
  });

  it("refuses a node id the flow already uses or that is not a valid name", () => {
    const base = { base: pipeline, projectId: PROJECT, operators: ops, proposal: { ...proposal(), inputs: [] }, outputs: [], parameters: [], from: FROM };
    expect(addNode({ ...base, nodeId: "load" })).toEqual({ refused: "This flow already has a step named load." });
    expect(addNode({ ...base, nodeId: "Bad Name" })).toEqual({
      refused: "Bad Name is not a step name: use lowercase letters, digits and _, starting with a letter.",
    });
  });
});
