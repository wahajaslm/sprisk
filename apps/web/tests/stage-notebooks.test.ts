import type { FlowDecision, PipelineVersion } from "@sprisk/contracts";
import { describe, expect, it } from "vitest";

import { stageNotebooks } from "../src/notebook/stageNotebooks.ts";
import { notebookOperator, operators, pipeline } from "./fixtures.ts";

const byRef = new Map([...operators, notebookOperator].map((o) => [o.id, o]));
const ids = (flow: PipelineVersion) => stageNotebooks(flow, byRef).map(({ name, nodes }) => [name, nodes.map((n) => n.id)]);

describe("a flow as one notebook per stage (ADR-0055)", () => {
  it("puts each step in its operator's stage, stages in order, steps in flow order", () => {
    expect(ids(pipeline)).toEqual([
      ["Load", ["load", "profile"]],
      ["Split", ["split"]],
      ["Clean", ["impute"]],
      ["Model", ["model"]],
      ["Evaluate", ["score"]],
    ]);
  });

  it("puts a step where its own stage says", () => {
    const flow = { ...pipeline, nodes: pipeline.nodes.map((n) => (n.id === "profile" ? { ...n, stage: "clean" as const } : n)) };
    expect(ids(flow)[2]).toEqual(["Clean", ["profile", "impute"]]);
  });

  it("puts a look at the training rows in Explore, after the split", () => {
    const flow = { ...pipeline, edges: [...pipeline.edges.filter((e) => e.to !== "profile.data"), { from: "split.train", to: "profile.data" }] };
    expect(ids(flow)[2]).toEqual(["Explore", ["profile"]]);
  });

  it("never puts a step in an earlier stage than a step it reads", () => {
    const flow = { ...pipeline, edges: [...pipeline.edges.filter((e) => e.to !== "profile.data"), { from: "impute.train", to: "profile.data" }] };
    expect(ids(flow)[2]).toEqual(["Clean", ["impute", "profile"]]);
  });

  it("puts a step whose operator is not installed after the steps it reads", () => {
    const flow = { ...pipeline, nodes: pipeline.nodes.map((n) => (n.id === "model" ? { ...n, operator: "sprisk.ml.gone@9.0.0" } : n)) };
    expect(ids(flow).find((entry) => (entry[1] as string[]).includes("model"))?.[0]).toBe("Clean");
  });

  it("never puts a step before a stage it reads, even when the step keeps its own", () => {
    const flow = {
      ...pipeline,
      nodes: pipeline.nodes.map((n) => (n.id === "profile" ? { ...n, stage: "explore" as const } : n)),
      edges: [...pipeline.edges.filter((e) => e.to !== "profile.data"), { from: "impute.train", to: "profile.data" }],
    };
    expect(ids(flow)[2]).toEqual(["Clean", ["impute", "profile"]]);
  });

  it("leaves out a stage with no steps", () => {
    const flow = { ...pipeline, nodes: pipeline.nodes.filter((n) => n.id !== "impute"), edges: [] };
    expect(ids(flow).map(([stage]) => stage)).toEqual(["Load", "Split", "Model", "Evaluate"]);
  });
});

const decision = (activity: string, steps: string[]): FlowDecision => ({
  decides: "split.method",
  method: "methodology.supervised.split_method@1.0.0",
  activity,
  question: "How are rows divided into training and test so the score is fair?",
  option: "item_groups",
  label: "Keep each item's rows on one side",
  reason: "Rows of one item stay on one side.",
  assurance: "rule",
  steps,
  promises: [],
});

const grouped = (flow: PipelineVersion, decisions: FlowDecision[]) =>
  stageNotebooks(flow, byRef, decisions).map(({ name, nodes }) => [name, nodes.map((n) => n.id)]);

describe("a decision's steps as one section per activity (ADR-0063)", () => {
  it("puts the steps a decision shaped under its activity, where its first step's stage sits", () => {
    expect(grouped(pipeline, [decision("Repeated observations", ["profile"]), decision("Fair evaluation", ["split"])])).toEqual([
      ["Load", ["load"]],
      ["Repeated observations", ["profile"]],
      ["Fair evaluation", ["split"]],
      ["Clean", ["impute"]],
      ["Model", ["model"]],
      ["Evaluate", ["score"]],
    ]);
  });

  it("gives each section the decisions it shows", () => {
    const fair = decision("Fair evaluation", ["split"]);
    const sections = stageNotebooks(pipeline, byRef, [fair]);
    expect(sections.find((s) => s.name === "Fair evaluation")?.decisions).toEqual([fair]);
    expect(sections.find((s) => s.name === "Load")?.decisions).toEqual([]);
  });

  it("keeps a step two decisions shaped under the first, and ignores steps the flow no longer has", () => {
    expect(grouped(pipeline, [decision("Fair evaluation", ["split", "gone"]), decision("Other", ["split"])])).toContainEqual([
      "Fair evaluation",
      ["split"],
    ]);
  });
});
