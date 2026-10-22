import { describe, expect, it } from "vitest";

import { activation, isOpen, lookedAt, reviewByRule, ROUTE_LINE, routeReason, routeWhen, ruleTree } from "../src/views/methodology/ruleTree.ts";

const rule = (id: string, stage: string, routes: string[], status = "active") =>
  ({ id, stage, status, alternatives: routes.map((r) => ({ id: r, label: r, rationale: "r" })) }) as never;
const S = (name: string) => `m.supervised.${name}`;
const U = (name: string) => `m.unsupervised.${name}`;

const RULES = [
  rule(S("fill"), "cleaning", ["median", "mean"]),
  rule(S("clip"), "cleaning", ["clip", "keep"]),
  rule(S("split"), "split", ["random", "time"]),
  rule(S("pca"), "features", ["pca"], "draft"),
  rule(U("algo"), "models", ["kmeans", "dbscan"]),
];
const tree = (rules = RULES, reviews = new Map(), path = false) => ruleTree(rules, reviews, { path });
const at = (t: ReturnType<typeof ruleTree>, id: string) => t.nodes.find((n) => n.id === id)!.position;
/** A node's middle, since a route grows to fit its condition. */
const mid = (t: ReturnType<typeof ruleTree>, id: string) => {
  const n = t.nodes.find((node) => node.id === id)!;
  return n.position.y + n.height! / 2;
};
const data = (t: ReturnType<typeof ruleTree>, id: string) => t.nodes.find((n) => n.id === id)!.data;
const links = (t: ReturnType<typeof ruleTree>) => t.edges.map((e) => `${e.source}>${e.target}`);
const lit = (t: ReturnType<typeof ruleTree>) => t.edges.filter((e) => e.data?.onPath).map((e) => `${e.source}>${e.target}`);
const settled = (rule: string, route: string) => ({ rule, status: "settled", subject_node_id: "step", reason: "r", recommended_alternative_id: route }) as never;
const sup = (stage: string) => `stage:supervised:${stage}`;

describe("methodology tree", () => {
  it("shares the question and data stages, then forks into a supervised and an unsupervised lane", () => {
    expect(links(tree())).toEqual([
      "root>stage:question",
      "stage:question>stage:data",
      "stage:data>lane:supervised",
      `lane:supervised>${sup("split")}`,
      `${sup("split")}>${S("split")}`,
      `${S("split")}>${S("split")}#random`,
      `${S("split")}>${S("split")}#time`,
      `${S("split")}#random>${sup("cleaning")}`,
      `${S("split")}#time>${sup("cleaning")}`,
      `${sup("cleaning")}>${S("fill")}`,
      `${S("fill")}>${S("fill")}#median`,
      `${S("fill")}>${S("fill")}#mean`,
      `${sup("cleaning")}>${S("clip")}`,
      `${S("clip")}>${S("clip")}#clip`,
      `${S("clip")}>${S("clip")}#keep`,
      `${S("fill")}#median>${sup("features")}`,
      `${S("fill")}#mean>${sup("features")}`,
      `${S("clip")}#clip>${sup("features")}`,
      `${S("clip")}#keep>${sup("features")}`,
      `${sup("features")}>${S("pca")}`,
      `${S("pca")}>${S("pca")}#pca`,
      "stage:data>lane:unsupervised",
      "lane:unsupervised>stage:unsupervised:models",
      `stage:unsupervised:models>${U("algo")}`,
      `${U("algo")}>${U("algo")}#kmeans`,
      `${U("algo")}>${U("algo")}#dbscan`,
    ]);
  });

  it("reads left to right: each lane's stages on its own line, decisions then routes after each stage", () => {
    const t = tree();
    const xs = ["root", "stage:data", "lane:supervised", sup("split"), S("split"), `${S("split")}#time`, sup("cleaning"), S("fill")].map((id) => at(t, id).x);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    expect(new Set([sup("split"), sup("cleaning"), sup("features"), "lane:supervised"].map((id) => mid(t, id))).size).toBe(1);
    expect(mid(t, "lane:supervised")).toBeLessThan(mid(t, "lane:unsupervised"));
    expect(at(t, "lane:supervised").x).toBe(at(t, "lane:unsupervised").x);
    expect(at(t, S("fill")).x).toBe(at(t, S("clip")).x);
  });

  it("stacks a stage's routes, centres each decision on its routes, and the stage on its whole fan", () => {
    const t = tree();
    // Branches meet a route at its label line, the top row, not the middle of its wrapped text.
    const line = (id: string) => at(t, id).y + ROUTE_LINE;
    expect(mid(t, S("fill"))).toBe((line(`${S("fill")}#median`) + line(`${S("fill")}#mean`)) / 2);
    const long = { ...(rule(S("split"), "split", ["a", "b"]) as object), alternatives: [{ id: "a", label: "a", condition: "x".repeat(140), rationale: "r" }, { id: "b", label: "b", rationale: "r" }] } as never;
    const wrapped = tree([long]);
    const wLine = (id: string) => at(wrapped, id).y + ROUTE_LINE;
    expect(mid(wrapped, S("split"))).toBe((wLine(`${S("split")}#a`) + wLine(`${S("split")}#b`)) / 2);
    expect(at(t, `${S("clip")}#clip`).y).toBeGreaterThan(at(t, `${S("fill")}#mean`).y);
    expect(mid(t, sup("cleaning"))).toBe((at(t, `${S("fill")}#median`).y + at(t, `${S("clip")}#keep`).y + t.nodes.find((n) => n.id === `${S("clip")}#keep`)!.height!) / 2);
  });

  it("leads a decision with no routes straight on to the next stage", () => {
    expect(links(tree([rule(S("split"), "split", []), rule(S("fill"), "cleaning", ["median"])]))).toContain(`${S("split")}>${sup("cleaning")}`);
  });

  it("numbers every node so it can be named: stage, decision within it, route within that", () => {
    const t = tree();
    expect(data(t, "stage:question")).toMatchObject({ code: "1" });
    expect(data(t, sup("split"))).toMatchObject({ code: "3" });
    expect(data(t, S("fill"))).toMatchObject({ code: "4.1" });
    expect(data(t, `${S("clip")}#keep`)).toMatchObject({ code: "4.2b" });
    expect(data(t, U("algo"))).toMatchObject({ code: "3.1" });
  });

  it("makes a route tall enough for its condition to wrap onto new lines", () => {
    const long = { ...(rule(S("split"), "split", ["a", "b"]) as object), alternatives: [{ id: "a", label: "a", condition: "x".repeat(140), rationale: "r" }, { id: "b", label: "b", rationale: "r" }] } as never;
    const t = tree([long]);
    const height = (id: string) => t.nodes.find((n) => n.id === id)!.height!;
    expect(height(`${S("split")}#a`)).toBeGreaterThan(height(`${S("split")}#b`));
  });

  it("shows drafts too, so every possibility is in the tree", () => {
    expect(tree().nodes.some((n) => n.id === `${S("pca")}#pca`)).toBe(true);
  });

  it("marks the route the flow's review recommends, and lights nothing while showing every possibility", () => {
    const t = tree(RULES, new Map([[S("split"), settled(S("split"), "time")]]));
    expect(data(t, `${S("split")}#time`)).toMatchObject({ picked: true, dimmed: false });
    expect(lit(t)).toEqual([]);
  });

  it("with the pipeline path on, lights the flow's lane and the routes it takes, and dims the other lane", () => {
    const reviews = new Map([
      [S("split"), settled(S("split"), "time")],
      [S("clip"), settled(S("clip"), "keep")],
    ]);
    const t = tree(RULES, reviews, true);
    expect(lit(t)).toEqual([
      "root>stage:question",
      "stage:question>stage:data",
      "stage:data>lane:supervised",
      `lane:supervised>${sup("split")}`,
      `${sup("split")}>${S("split")}`,
      `${S("split")}>${S("split")}#time`,
      `${S("split")}#time>${sup("cleaning")}`,
      `${sup("cleaning")}>${S("clip")}`,
      `${S("clip")}>${S("clip")}#keep`,
    ]);
    expect(data(t, "lane:unsupervised")).toMatchObject({ dimmed: true });
    expect(data(t, U("algo"))).toMatchObject({ dimmed: true });
  });

  it("passes the line straight on from a stage the flow uses nothing of, and dims what it does not touch", () => {
    const t = tree(RULES, new Map([[S("clip"), settled(S("clip"), "keep")]]), true);
    expect(t.edges.find((e) => e.id === `${sup("split")}>${sup("cleaning")}`)!.data).toMatchObject({ onPath: true, kind: "skip" });
    expect(data(t, S("split"))).toMatchObject({ dimmed: true });
    expect(data(t, `${S("fill")}#median`)).toMatchObject({ dimmed: true });
    expect(data(t, sup("features"))).toMatchObject({ dimmed: true });
  });
});

describe("one rule on several steps", () => {
  const item = (rule: string, status: string, step: string) => ({ rule, status, subject_node_id: step }) as never;

  it("shows the first open item, since that is where work is needed", () => {
    const byRule = reviewByRule([item("a", "settled", "s1"), item("a", "needs_run", "s2"), item("a", "waiting", "s3")]);
    expect(byRule.get("a")).toMatchObject({ subject_node_id: "s2" });
  });

  it("counts a reopened decision as open", () => {
    const byRule = reviewByRule([item("a", "settled", "s1"), item("a", "reopen", "s2")]);
    expect(byRule.get("a")).toMatchObject({ subject_node_id: "s2" });
    expect(isOpen("reopen")).toBe(true);
    expect(isOpen("settled")).toBe(false);
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
      { id: "temporal", label: "Temporal", rationale: "r" },
      { id: "stratified", label: "Stratified", rationale: "r" },
      { id: "group", label: "Group", condition: "an entity column is confirmed" },
      { id: "manual", label: "Manual", rationale: "r" },
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

  it("reads a list of dataset values and a fact measured before the split in plain words", () => {
    const markers = {
      alternatives: [{ id: "mark", label: "Mark", rationale: "r" }],
      examples: [{ given: { "input.column.age.numeric_share": 0.98, "input.column.age.unconverted": ["?", "n/a"] }, picks: "mark" }],
    } as never;
    expect(routeWhen(markers, "mark")).toBe("age numeric share = 0.98 · age unconverted = ?, n/a");
  });

  it("gives nothing for a route with neither", () => {
    expect(routeWhen(split, "manual")).toBeUndefined();
  });

  it("says which steps a decision activates on", () => {
    expect(activation(split)).toBe("on random split or drop missing steps");
    expect(activation({ applies_to: [] } as never)).toBeUndefined();
  });

  it("says when a route is taken in the rule's own words, with its settings' values filled in", () => {
    const worded = {
      id: S("enc"),
      stage: "features",
      status: "active",
      policy_thresholds: { high_cardinality_threshold: 15 },
      alternatives: [{ id: "leave_out", label: "Leave out", rationale: "r", when: "more than {high_cardinality_threshold} categories", condition: "old note" }],
      examples: [{ given: { "column.title.distinct": 8000 }, picks: "leave_out" }],
    } as never;
    expect(routeReason(worded, (worded as { alternatives: never[] }).alternatives[0]!, undefined)).toEqual({ kind: "when", text: "more than 15 categories" });
  });

  it("names what a rule looks at in plain words, from the facts it reads", () => {
    const reads = { reads: ["question.target", "question.costs.positive", "question.costs.false_negative", "column.*.missing_share", "column.*.skewness", "target.rarest_share", "flow.model_families", "rows"] } as never;
    expect(lookedAt(reads)).toEqual(["the target", "the stated error costs", "each column's share of missing values", "each column's skewness", "the target's rarest class's share", "model families", "the number of rows"]);
  });
});

