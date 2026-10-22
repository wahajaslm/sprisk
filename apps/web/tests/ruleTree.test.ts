import { describe, expect, it } from "vitest";

import { activation, reviewByRule, routeWhen, ruleTree } from "../src/views/methodology/ruleTree.ts";

const rule = (id: string, stage: string, routes: string[], status = "active") =>
  ({ id, stage, status, alternatives: routes.map((r) => ({ id: r, label: r })) }) as never;

const RULES = [
  rule("fill", "cleaning", ["median", "mean"]),
  rule("clip", "cleaning", ["clip", "keep"]),
  rule("split", "split", ["random", "time"]),
  rule("pca", "features", ["pca"], "draft"),
];
const tree = (rules = RULES, reviews = new Map(), path = false) => ruleTree(rules, reviews, { path });
const at = (t: ReturnType<typeof ruleTree>, id: string) => t.nodes.find((n) => n.id === id)!.position;
const links = (t: ReturnType<typeof ruleTree>) => t.edges.map((e) => `${e.source}>${e.target}`);
const lit = (t: ReturnType<typeof ruleTree>) => t.edges.filter((e) => e.data?.onPath).map((e) => `${e.source}>${e.target}`);
const settled = (rule: string, route: string) => ({ rule, status: "settled", subject_node_id: rule, recommended_alternative_id: route }) as never;

describe("methodology tree", () => {
  it("connects the steps: each stage fans out into its decisions, each decision into its routes, and the routes join into the next stage", () => {
    expect(links(tree())).toEqual([
      "root>stage:question",
      "stage:question>stage:data",
      "stage:data>stage:split",
      "stage:split>split",
      "split>split#random",
      "split>split#time",
      "split#random>stage:cleaning",
      "split#time>stage:cleaning",
      "stage:cleaning>fill",
      "fill>fill#median",
      "fill>fill#mean",
      "stage:cleaning>clip",
      "clip>clip#clip",
      "clip>clip#keep",
      "fill#median>stage:features",
      "fill#mean>stage:features",
      "clip#clip>stage:features",
      "clip#keep>stage:features",
      "stage:features>pca",
      "pca>pca#pca",
      "pca#pca>stage:models",
      "stage:models>stage:evaluation",
      "stage:evaluation>stage:reporting",
    ]);
  });

  it("reads left to right: stages on one line, then a column of decisions, then a column of routes", () => {
    const t = tree();
    const xs = ["root", "stage:split", "split", "split#time", "stage:cleaning", "fill", "fill#mean", "stage:features"].map((id) => at(t, id).x);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    expect(new Set(["stage:split", "stage:cleaning", "stage:features"].map((id) => at(t, id).y)).size).toBe(1);
    expect(at(t, "fill").x).toBe(at(t, "clip").x);
    expect(at(t, "fill#median").x).toBe(at(t, "clip#keep").x);
  });

  it("stacks a stage's routes, centres each decision on its routes, and the stage on its whole fan", () => {
    const t = tree();
    expect(at(t, "fill").y).toBe((at(t, "fill#median").y + at(t, "fill#mean").y) / 2);
    expect(at(t, "clip#clip").y).toBeGreaterThan(at(t, "fill#mean").y);
    expect(at(t, "stage:cleaning").y).toBe((at(t, "fill#median").y + at(t, "clip#keep").y) / 2);
  });

  it("leads a decision with no routes straight on to the next stage", () => {
    expect(links(tree([rule("split", "split", [])]))).toContain("split>stage:cleaning");
  });

  it("shows drafts too, so every possibility is in the tree", () => {
    expect(tree().nodes.some((n) => n.id === "pca#pca")).toBe(true);
  });

  it("marks the route the flow's review recommends, and lights nothing while showing every possibility", () => {
    const t = tree(RULES, new Map([["split", settled("split", "time")]]));
    expect(t.nodes.find((n) => n.id === "split#time")!.data).toMatchObject({ picked: true, dimmed: false });
    expect(lit(t)).toEqual([]);
  });

  it("with the pipeline path on, lights the line through the decisions the flow uses and the routes it takes", () => {
    const reviews = new Map([
      ["split", settled("split", "time")],
      ["clip", settled("clip", "keep")],
    ]);
    expect(lit(tree(RULES, reviews, true))).toEqual([
      "root>stage:question",
      "stage:question>stage:data",
      "stage:data>stage:split",
      "stage:split>split",
      "split>split#time",
      "split#time>stage:cleaning",
      "stage:cleaning>clip",
      "clip>clip#keep",
    ]);
  });

  it("passes the line straight on from a stage the flow uses nothing of, and dims what it does not touch", () => {
    const t = tree(RULES, new Map([["clip", settled("clip", "keep")]]), true);
    expect(t.edges.find((e) => e.id === "stage:split>stage:cleaning")!.data).toMatchObject({ onPath: true, kind: "skip" });
    expect(t.nodes.find((n) => n.id === "split")!.data).toMatchObject({ dimmed: true });
    expect(t.nodes.find((n) => n.id === "fill#median")!.data).toMatchObject({ dimmed: true });
    expect(t.nodes.find((n) => n.id === "stage:features")!.data).toMatchObject({ dimmed: true });
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

describe("activation conditions", () => {
  const split = {
    id: "split",
    applies_to: ["sprisk.validation.random_split", "sprisk.clean.drop_missing"],
    alternatives: [
      { id: "temporal", label: "Temporal" },
      { id: "stratified", label: "Stratified" },
      { id: "group", label: "Group", condition: "an entity column is confirmed" },
      { id: "manual", label: "Manual" },
    ],
    examples: [
      { given: { "question.target": "churned", "question.task": "classification", "question.time_column": "signup_date" }, picks: "temporal" },
      { given: { "question.target": "churned", "question.task": { value: "classification", origin: "confirmed" }, "column.age.missing_share": 0.1 }, picks: "stratified" },
    ],
  } as never;

  it("gives a route the written condition of a draft", () => {
    expect(routeWhen(split, "group")).toBe("an entity column is confirmed");
  });

  it("gives an active rule's route the tested example that picks it, in plain words, leaving out the target's name", () => {
    expect(routeWhen(split, "temporal")).toBe("task = classification · time column = signup_date");
    expect(routeWhen(split, "stratified")).toBe("task = classification · age missing share = 0.1");
  });

  it("gives nothing for a route with neither", () => {
    expect(routeWhen(split, "manual")).toBeUndefined();
  });

  it("says which steps a decision activates on", () => {
    expect(activation(split)).toBe("on random split or drop missing steps");
    expect(activation({ applies_to: [] } as never)).toBeUndefined();
  });
});
