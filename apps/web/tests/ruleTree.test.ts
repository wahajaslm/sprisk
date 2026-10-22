import { describe, expect, it } from "vitest";

import { reviewByRule, ruleTree } from "../src/views/methodology/ruleTree.ts";

const rule = (id: string, stage: string, routes = 1) =>
  ({ id, stage, alternatives: Array.from({ length: routes }, (_, i) => ({ id: `r${i}` })) }) as never;

describe("methodology map", () => {
  it("draws one box per stage with rules, left to right in decision order: split before cleaning", () => {
    const tree = ruleTree([rule("a", "cleaning"), rule("b", "split"), rule("c", "models")], new Map());
    const boxes = tree.nodes.filter((n) => n.type === "stage");
    expect(boxes.map((n) => n.id)).toEqual(["stage:split", "stage:cleaning", "stage:models"]);
    const xs = boxes.map((n) => n.position.x);
    expect([...xs].sort((p, q) => p - q)).toEqual(xs);
  });

  it("joins each stage box to the next one", () => {
    const tree = ruleTree([rule("a", "cleaning"), rule("b", "split"), rule("c", "models")], new Map());
    expect(tree.edges.map((e) => `${e.source}>${e.target}`)).toEqual(["stage:split>stage:cleaning", "stage:cleaning>stage:models"]);
  });

  it("stacks each stage's decisions inside its box, and the box holds them all", () => {
    const tree = ruleTree([rule("a", "split", 3), rule("b", "split", 1)], new Map());
    const node = (id: string) => tree.nodes.find((n) => n.id === id)!;
    expect(node("a").parentId).toBe("stage:split");
    expect(node("b").position.y).toBeGreaterThan(node("a").position.y + node("a").height!);
    expect(node("stage:split").height).toBeGreaterThanOrEqual(node("b").position.y + node("b").height!);
  });

  it("makes a decision with more routes taller, so every route and its condition shows", () => {
    const tree = ruleTree([rule("few", "split", 1), rule("many", "cleaning", 4)], new Map());
    const height = (id: string) => tree.nodes.find((n) => n.id === id)!.height!;
    expect(height("many")).toBeGreaterThan(height("few"));
  });

  it("puts the flow's review of each decision on its card", () => {
    const item = { rule: "a", status: "proposal", reason: "r", decides: "x.y", stage: "split" } as never;
    const tree = ruleTree([rule("a", "split")], new Map([["a", item]]));
    const card = tree.nodes.find((n) => n.id === "a")!;
    expect(card.type === "decision" && card.data.review).toBe(item);
  });
});

describe("one rule on several steps", () => {
  const item = (rule: string, status: string, step: string) => ({ rule, status, subject_node_id: step }) as never;

  it("shows the first open item, since that is where work is needed", () => {
    const byRule = reviewByRule([item("a", "settled", "s1"), item("a", "needs_run", "s2"), item("a", "waiting", "s3")]);
    expect(byRule.get("a")).toMatchObject({ subject_node_id: "s2" });
  });

  it("shows the first item when nothing is open", () => {
    const byRule = reviewByRule([item("a", "settled", "s1"), item("a", "not_applicable", "s2")]);
    expect(byRule.get("a")).toMatchObject({ subject_node_id: "s1" });
  });
});
