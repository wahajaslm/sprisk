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
