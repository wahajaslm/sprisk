import type { PipelineVersion } from "@sprisk/contracts";
import { describe, expect, it } from "vitest";

import { stageNotebooks } from "../src/notebook/stageNotebooks.ts";
import { notebookOperator, operators, pipeline } from "./fixtures.ts";

const byRef = new Map([...operators, notebookOperator].map((o) => [o.id, o]));
const ids = (flow: PipelineVersion) => stageNotebooks(flow, byRef).map(({ stage, nodes }) => [stage, nodes.map((n) => n.id)]);

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
