import { describe, expect, it } from "vitest";

import { ruleTree } from "../src/views/methodology/ruleTree.ts";

const rule = (id: string, stage: string) => ({ id, stage }) as never;

describe("rule tree", () => {
  it("links the root to each stage in stage order, and each stage to its rules", () => {
    const tree = ruleTree([rule("b", "split"), rule("a", "cleaning"), rule("c", "split")]);
    expect(tree.nodes.filter((n) => n.type === "stage").map((n) => n.id)).toEqual(["stage:cleaning", "stage:split"]);
    expect(tree.edges.map((e) => `${e.source}>${e.target}`)).toEqual([
      "root>stage:cleaning",
      "stage:cleaning>a",
      "root>stage:split",
      "stage:split>b",
      "stage:split>c",
    ]);
  });

  it("stacks rules in one column and centres each stage on its rules", () => {
    const tree = ruleTree([rule("a", "cleaning"), rule("b", "split"), rule("c", "split")]);
    const at = (id: string) => tree.nodes.find((n) => n.id === id)!.position;
    expect(new Set(["a", "b", "c"].map((id) => at(id).x)).size).toBe(1);
    expect(at("b").y).toBeGreaterThan(at("a").y);
    expect(at("stage:split").y).toBe((at("b").y + at("c").y) / 2);
    expect(at("stage:split").x).toBeLessThan(at("b").x);
    expect(at("root").x).toBeLessThan(at("stage:cleaning").x);
  });
});
