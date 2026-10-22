import { describe, expect, it } from "vitest";

import { decisionTree, layoutDecisionTree } from "../src/flow/decisionTree.ts";

const rule = (id: string, stage: string, routes: string[], status = "active", conditions: Record<string, string> = {}) =>
  ({
    id,
    name: id.toUpperCase(),
    stage,
    status,
    decides: `${stage}.${id}`,
    alternatives: routes.map((r) => ({ id: r, label: r, description: `${r} does`, rationale: "why", action: { type: "replace_node" }, ...(conditions[r] ? { condition: conditions[r] } : {}) })),
  }) as never;

const RULES = [rule("fill", "cleaning", ["median", "mean"]), rule("split", "split", ["random", "time"]), rule("pca", "features", ["pca", "none"], "draft")];
const links = (tree: ReturnType<typeof decisionTree>) => tree.edges.map((e) => `${e.source}>${e.target}`);

describe("decision tree", () => {
  it("branches each decision into its routes, and every route leads on to the next decision", () => {
    const tree = decisionTree(RULES, new Map(), { drafts: false });
    expect(links(tree)).toEqual(["split>split#random", "split>split#time", "split#random>fill", "split#time>fill", "fill>fill#median", "fill>fill#mean"]);
  });

  it("leaves draft decisions out unless asked, so the default tree is what runs", () => {
    expect(decisionTree(RULES, new Map(), { drafts: false }).nodes.some((n) => n.id === "pca")).toBe(false);
    expect(links(decisionTree(RULES, new Map(), { drafts: true }))).toContain("fill#mean>pca");
  });


  it("lights the route the flow's review recommends and dims the others", () => {
    const review = { rule: "split", status: "settled", reason: "r", decides: "split.split", stage: "split", recommended_alternative_id: "time" } as never;
    const tree = decisionTree(RULES, new Map([["split", review]]), { drafts: false });
    const route = (id: string) => tree.nodes.find((n) => n.id === id)!;
    expect(route("split#time").data).toMatchObject({ picked: true, dimmed: false });
    expect(route("split#random").data).toMatchObject({ picked: false, dimmed: true });
    expect(route("fill#median").data).toMatchObject({ picked: false, dimmed: false });
  });

  it("reads left to right: stages in decision order, each decision before its routes, routes stacked, all inside the stage box", async () => {
    const laid = await layoutDecisionTree(decisionTree(RULES, new Map(), { drafts: false }));
    const at = (id: string) => laid.nodes.find((n) => n.id === id)!;
    expect(at("stage:split").position.x).toBeLessThan(at("stage:cleaning").position.x);
    expect(at("split").parentId).toBe("stage:split");
    expect(at("split").position.x + at("split").width!).toBeLessThan(at("split#time").position.x);
    expect(at("split#random").position.x).toBe(at("split#time").position.x);
    const box = at("stage:split");
    for (const id of ["split", "split#random", "split#time"]) {
      const node = at(id);
      expect(node.position.x + node.width!).toBeLessThanOrEqual(box.width!);
      expect(node.position.y + node.height!).toBeLessThanOrEqual(box.height!);
    }
  });
});
