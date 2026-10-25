import { describe, expect, it } from "vitest";

import { flowPositions } from "../src/flow/layout.ts";
import { NODE_SIZE } from "../src/workbench/detail.ts";
import { pipeline } from "./fixtures.ts";

const STAGE: Record<string, string> = {
  load: "Explore",
  profile: "Explore",
  split: "Split",
  impute: "Clean",
  model: "Model",
  score: "Model",
};

// The Flow Studio main screen: steps 176 × 40, 50 px apart, 72 px below their card's top;
// cards 196 px wide, 32 px apart, all as tall as the fullest one.
describe("the compact canvas layout, as the design's main screen draws it", () => {
  const layout = () => flowPositions(pipeline, () => NODE_SIZE.compact, (id) => STAGE[id]);

  it("sizes a compact step 176 × 40", () => {
    expect(NODE_SIZE.compact).toEqual({ width: 176, height: 40 });
  });

  it("puts a stage's steps 50 px apart, the first 72 px below the card's top", async () => {
    const { nodes, groups } = await layout();
    const model = groups.find((g) => g.id === "Model")!;
    expect(nodes.get("model")!.y - model.y).toBe(72);
    expect(nodes.get("score")!.y - nodes.get("model")!.y).toBe(50);
  });

  it("makes every card 196 px wide and as tall as the fullest, with 32 px between cards", async () => {
    const { groups } = await layout();
    const byX = [...groups].sort((a, b) => a.x - b.x);
    for (const g of byX) expect(g.width).toBe(196);
    expect(new Set(byX.map((g) => g.height))).toEqual(new Set([72 + 2 * 50 + 8]));
    for (let i = 1; i < byX.length; i++) expect(byX[i]!.x - (byX[i - 1]!.x + byX[i - 1]!.width)).toBe(32);
  });

  it("starts at the canvas origin, so it opens at the top left", async () => {
    const { groups } = await layout();
    expect(Math.min(...groups.map((g) => g.x))).toBe(0);
    expect(Math.min(...groups.map((g) => g.y))).toBe(0);
  });
});

describe("steps inside one stage", () => {
  // split feeds two checks in its own stage: drawn in one column, the line to the second would
  // pass behind the first and read as if they were linked.
  const fanned = {
    ...pipeline,
    nodes: [...pipeline.nodes, { id: "overlap", operator: "sprisk.profile.summarize@1.0.0", params: {} }, { id: "shape", operator: "sprisk.profile.summarize@1.0.0", params: {} }],
    edges: [...pipeline.edges, { from: "split.train", to: "shape.data" }, { from: "split.test", to: "overlap.data" }],
  };
  const stage = (id: string) => ({ ...STAGE, shape: "Split", overlap: "Split" })[id];

  it("puts the steps one step feeds side by side in the next column, never under each other's line", async () => {
    const { nodes } = await flowPositions(fanned, () => NODE_SIZE.compact, stage);
    const [split, shape, overlap] = ["split", "shape", "overlap"].map((id) => nodes.get(id)!);
    expect(shape!.x).toBe(overlap!.x);
    expect(shape!.x).toBeGreaterThan(split!.x + NODE_SIZE.compact.width);
    expect(shape!.y).not.toBe(overlap!.y);
  });

  it("starts the fed steps one row lower, so a line leaving the stage from the step passes above them", async () => {
    const { nodes } = await flowPositions(fanned, () => NODE_SIZE.compact, stage);
    const split = nodes.get("split")!;
    for (const id of ["shape", "overlap"]) expect(nodes.get(id)!.y).toBeGreaterThanOrEqual(split.y + NODE_SIZE.compact.height);
  });

  it("keeps a chain of steps in one column", async () => {
    const { nodes } = await flowPositions(pipeline, () => NODE_SIZE.compact, (id) => STAGE[id]);
    expect(nodes.get("score")!.x).toBe(nodes.get("model")!.x);
  });
});
