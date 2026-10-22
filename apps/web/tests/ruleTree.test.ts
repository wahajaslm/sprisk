import { describe, expect, it } from "vitest";

import { reviewByRule, ruleTree } from "../src/views/methodology/ruleTree.ts";

const rule = (id: string, stage: string, routes: string[], status = "active") =>
  ({ id, stage, status, alternatives: routes.map((r) => ({ id: r, label: r })) }) as never;

const RULES = [rule("fill", "cleaning", ["median", "mean"]), rule("split", "split", ["random", "time"]), rule("pca", "features", ["pca"], "draft")];
const tree = (rules = RULES, reviews = new Map(), path = false) => ruleTree(rules, reviews, { path });
const at = (t: ReturnType<typeof ruleTree>, id: string) => t.nodes.find((n) => n.id === id)!.position;

describe("methodology tree", () => {
  it("shows every possibility: all stages in decision order, every decision, drafts too, and every route", () => {
    expect(tree().edges.map((e) => `${e.source}>${e.target}`)).toEqual([
      "root>stage:split",
      "stage:split>split",
      "split>split#random",
      "split>split#time",
      "root>stage:cleaning",
      "stage:cleaning>fill",
      "fill>fill#median",
      "fill>fill#mean",
      "root>stage:features",
      "stage:features>pca",
      "pca>pca#pca",
    ]);
  });

  it("stacks the routes as leaves and centres each parent on its children, one column per level", () => {
    const t = tree();
    expect(at(t, "split#time").y).toBeGreaterThan(at(t, "split#random").y);
    expect(at(t, "split").y).toBe((at(t, "split#random").y + at(t, "split#time").y) / 2);
    expect(at(t, "stage:split").y).toBe(at(t, "split").y);
    expect(at(t, "root").y).toBe((at(t, "stage:split").y + at(t, "stage:features").y) / 2);
    const xs = ["root", "stage:split", "split", "split#random"].map((id) => at(t, id).x);
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
  });

  it("gives a decision with no routes a row of its own", () => {
    const t = tree([rule("models", "models", []), rule("split", "split", ["random"])]);
    expect(at(t, "models").y).toBeGreaterThan(at(t, "split#random").y);
  });


  it("marks the route the flow's review recommends, and dims nothing while showing every possibility", () => {
    const review = { rule: "split", status: "settled", subject_node_id: "split", recommended_alternative_id: "time" } as never;
    const t = tree(RULES, new Map([["split", review]]));
    const data = (id: string) => t.nodes.find((n) => n.id === id)!.data;
    expect(data("split#time")).toMatchObject({ picked: true, dimmed: false });
    expect(data("split#random")).toMatchObject({ picked: false, dimmed: false });
    expect(data("split")).toMatchObject({ review, dimmed: false });
    expect(t.edges.every((e) => !e.data?.onPath)).toBe(true);
  });

  it("with the pipeline path on, lights the flow's path and dims all it does not touch", () => {
    const review = { rule: "split", status: "settled", subject_node_id: "split", recommended_alternative_id: "time" } as never;
    const t = tree(RULES, new Map([["split", review]]), true);
    const data = (id: string) => t.nodes.find((n) => n.id === id)!.data;
    expect(data("split#time")).toMatchObject({ picked: true, dimmed: false });
    expect(data("split#random")).toMatchObject({ dimmed: true });
    expect(data("fill")).toMatchObject({ dimmed: true });
    expect(data("stage:cleaning")).toMatchObject({ dimmed: true });
    expect(data("stage:split")).toMatchObject({ dimmed: false });
    expect(t.edges.filter((e) => e.data?.onPath).map((e) => e.id)).toEqual(["root>stage:split", "stage:split>split", "split>split#time"]);
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
