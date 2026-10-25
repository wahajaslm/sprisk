import type { FlowDecision, PipelineVersion } from "@sprisk/contracts";
import { describe, expect, it } from "vitest";

import { stageNotebooks } from "../src/notebook/stageNotebooks.ts";
import { notebookOperator, operators, pipeline } from "./fixtures.ts";

const byRef = new Map([...operators, notebookOperator].map((o) => [o.id, o]));
const ids = (flow: PipelineVersion) => stageNotebooks(flow, byRef).map(({ name, nodes }) => [name, nodes.map((n) => n.id)]);

describe("a flow as one notebook per stage (ADR-0055)", () => {
  it("puts each step in its operator's stage, stages in order, steps in flow order", () => {
    expect(ids(pipeline)).toEqual([
      ["Load", ["load"]],
      ["Explore", ["profile"]],
      ["Split", ["split"]],
      ["Features", ["impute"]],
      ["Model", ["model"]],
      ["Evaluate", ["score"]],
    ]);
  });

  it("puts cleaning that reads the loaded rows before the split, and the split after it", () => {
    const flow = {
      ...pipeline,
      edges: [
        ...pipeline.edges.filter((e) => e.to !== "split.data" && !e.to.startsWith("impute.") && !e.from.startsWith("impute.")),
        { from: "load.data", to: "impute.train" },
        { from: "impute.train", to: "split.data" },
      ],
    };
    expect(ids(flow).slice(0, 4)).toEqual([
      ["Load", ["load"]],
      ["Explore", ["profile"]],
      ["Clean", ["impute"]],
      ["Split", ["split"]],
    ]);
  });

  it("puts a step where its own stage says", () => {
    const flow = { ...pipeline, nodes: pipeline.nodes.map((n) => (n.id === "profile" ? { ...n, stage: "clean" as const } : n)) };
    expect(ids(flow)[1]).toEqual(["Clean", ["profile"]]);
  });

  it("puts a look at the loaded rows in Data exploration, before the split", () => {
    expect(stageNotebooks(pipeline, byRef).map((s) => s.title)).toEqual(["Data loading", "Data exploration", "Train/test split", "Feature engineering", "Modeling", "Evaluation"]);
  });

  it("puts a look at what the split wrote with the split, never before it", () => {
    const flow = { ...pipeline, edges: [...pipeline.edges.filter((e) => e.to !== "profile.data"), { from: "split.train", to: "profile.data" }] };
    expect(ids(flow)[1]).toEqual(["Split", ["split", "profile"]]);
  });

  it("never puts a step in an earlier stage than a step it reads", () => {
    const flow = { ...pipeline, edges: [...pipeline.edges.filter((e) => e.to !== "profile.data"), { from: "impute.train", to: "profile.data" }] };
    expect(ids(flow)[2]).toEqual(["Features", ["impute", "profile"]]);
  });

  it("puts a step whose operator is not installed after the steps it reads", () => {
    const flow = { ...pipeline, nodes: pipeline.nodes.map((n) => (n.id === "model" ? { ...n, operator: "sprisk.ml.gone@9.0.0" } : n)) };
    expect(ids(flow).find((entry) => (entry[1] as string[]).includes("model"))?.[0]).toBe("Features");
  });

  it("never puts a step before a stage it reads, even when the step keeps its own", () => {
    const flow = {
      ...pipeline,
      nodes: pipeline.nodes.map((n) => (n.id === "profile" ? { ...n, stage: "explore" as const } : n)),
      edges: [...pipeline.edges.filter((e) => e.to !== "profile.data"), { from: "impute.train", to: "profile.data" }],
    };
    expect(ids(flow)[2]).toEqual(["Features", ["impute", "profile"]]);
  });

  it("leaves out a stage with no steps", () => {
    const flow = { ...pipeline, nodes: pipeline.nodes.filter((n) => n.id !== "impute"), edges: [] };
    expect(ids(flow).map(([stage]) => stage)).toEqual(["Load", "Explore", "Split", "Model", "Evaluate"]);
  });
});

const decision = (activity: string, steps: string[]): FlowDecision => ({
  decides: "split.method",
  method: "methodology.supervised.split_method@1.0.0",
  name: "Train/test split",
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

describe("a decision's steps stay in their stage (ADR-0065)", () => {
  it("never makes a stage of an activity: the steps a decision shaped keep their stage", () => {
    expect(grouped(pipeline, [decision("Repeated observations", ["profile"]), decision("Fair evaluation", ["split"])])).toEqual([
      ["Load", ["load"]],
      ["Explore", ["profile"]],
      ["Split", ["split"]],
      ["Features", ["impute"]],
      ["Model", ["model"]],
      ["Evaluate", ["score"]],
    ]);
  });

  it("gives each stage the decisions that shaped its steps, once each", () => {
    const fair = decision("Fair evaluation", ["split", "gone"]);
    const sections = stageNotebooks(pipeline, byRef, [fair, fair]);
    expect(sections.find((s) => s.name === "Split")?.decisions).toEqual([fair]);
    expect(sections.find((s) => s.name === "Load")?.decisions).toEqual([]);
  });
});
