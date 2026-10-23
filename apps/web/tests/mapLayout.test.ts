import { describe, expect, it } from "vitest";

import { levelOf, MAP, mapLayout, short, wrap } from "../src/views/methodology/mapLayout.ts";

const rule = (id: string, stage: string, routes: string[], extra: object = {}) =>
  ({ id, name: id, stage, decides: `${stage}.x`, status: "active", reads: ["column.*.distinct"], alternatives: routes.map((r) => ({ id: r, label: r, rationale: `why ${r}`, when: `when ${r}`, action: { type: "pass_through" } })), ...extra }) as never;
const C = (n: string) => `m.common.${n}`;
const S = (n: string) => `m.supervised.${n}`;
const U = (n: string) => `m.unsupervised.${n}`;

const RULES = [
  rule(C("goal"), "question", ["stated"], { decides: "question.objective", reads: ["question.objective"], question: "What is the goal?" }),
  rule(C("dupes"), "data", ["drop", "keep"]),
  rule(S("split"), "split", ["random", "time"]),
  rule(S("fill"), "cleaning", ["median", "mean", "drop"]),
  rule(S("pick"), "models", [], { selection: "shortlist" }),
  rule(S("loop"), "evaluation", ["finish", "again"]),
  rule(U("algo"), "models", ["kmeans", "dbscan"]),
];
// The loop rule's "again" route reopens the cleaning stage.
(RULES[5] as unknown as { alternatives: { action: object }[] }).alternatives[1]!.action = { type: "reopen", params: { stage: "cleaning" } };

const layout = (reviews = new Map(), path = false) => mapLayout(RULES, reviews, { path });
type L = ReturnType<typeof layout>;
const node = (l: L, id: string) => l.nodes.find((n) => n.id === id)!;
const route = (l: L, id: string) => l.routes.find((r) => r.id === id)!;

describe("methodology map canvas", () => {
  it("runs the trunk on the middle line, the supervised branch above and the unsupervised below", () => {
    const l = layout();
    expect([node(l, C("goal")).y, node(l, C("dupes")).y, node(l, "fork").y]).toEqual([MAP.trunk, MAP.trunk, MAP.trunk]);
    expect([S("split"), S("fill"), S("pick"), S("loop"), "end:supervised"].map((id) => node(l, id).y)).toEqual(Array(5).fill(MAP.above));
    expect([node(l, U("algo")).y, node(l, "end:unsupervised").y]).toEqual([MAP.below, MAP.below]);
    const xs = [C("goal"), C("dupes"), "fork", S("split"), S("fill")].map((id) => node(l, id).x);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
  });

  it("marks a decision by its level: the data settles it, a shortlist is tried, a person is asked", () => {
    expect(levelOf(RULES[1]!)).toBe("rule");
    expect(levelOf(RULES[4]!)).toBe("try");
    expect(levelOf(RULES[0]!)).toBe("ask");
  });

  it("writes each decision's question above it, wrapped to short lines", () => {
    expect(node(layout(), C("goal")).lines).toEqual(["What is the goal?"]);
    expect(wrap("How should missing values be filled?", 18)).toEqual(["How should missing", "values be filled?"]);
    expect(short("Costs stated as equal")).toBe("Costs stated as…");
    // Words clear the highest route dot beside the node: fill's top route sits 36 above it.
    const l = layout();
    expect(node(l, S("fill")).lift).toBe(36 + 28);
    expect(node(l, S("split")).lift).toBe(18 + 28);
    expect(node(l, C("goal")).lift).toBe(40);
    // The fork's dot is far to the left of a branch's first decision, so it lifts nothing.
    expect(node(l, U("algo")).lift).toBe(18 + 28);
  });

  it("draws each route as a dot halfway to the next decision, spread evenly about the line", () => {
    const l = layout();
    const fill = node(l, S("fill"));
    const next = node(l, S("pick"));
    const dots = ["median", "mean", "drop"].map((r) => route(l, `${S("fill")}#${r}`));
    expect(new Set(dots.map((d) => d.x))).toEqual(new Set([fill.x + (next.x - fill.x) / 2]));
    expect(dots.map((d) => d.y - fill.y)).toEqual([-MAP.routeDy, 0, MAP.routeDy]);
    expect(dots.map((d) => d.to)).toEqual([S("pick"), S("pick"), S("pick")]);
    expect(dots[0]).toMatchObject({ label: "median", title: "median: when median" });
  });

  it("forks on whether the question has a target, into each branch's first decision", () => {
    const l = layout();
    expect(l.routes.filter((r) => r.from === "fork").map((r) => [r.label, r.to, r.title])).toEqual([
      ["yes · supervised", S("split"), "the question has a target"],
      ["no · unsupervised", U("algo"), "the question has no target"],
    ]);
    expect(route(l, `${C("dupes")}#keep`).to).toBe("fork");
  });

  it("loops a route that reopens a stage back to that stage's first decision, and ends each branch on the final scoring", () => {
    const l = layout();
    expect(route(l, `${S("loop")}#again`)).toMatchObject({ loop: true, to: S("fill") });
    expect(route(l, `${S("loop")}#finish`)).toMatchObject({ loop: false, to: "end:supervised" });
    expect(route(l, `${S("pick")}#best`).to).toBe(S("loop"));
  });

  it("names each stage once, with how many decisions it holds", () => {
    expect(layout().bands.map((b) => [b.title, b.caption])).toEqual([
      ["QUESTION", "1 decision"],
      ["DATA", "1 decision"],
      ["FORK", "target?"],
      ["SPLIT", "1 decision"],
      ["CLEANING", "1 decision"],
      ["MODELS", "1 decision"],
      ["EVALUATION", "1 decision"],
      ["MODELS", "1 decision"],
    ]);
  });

  it("with the pipeline path on, marks only the routes the flow's rules chose", () => {
    const chose = { rule: S("split"), status: "settled", subject_node_id: "split", reason: "r", recommended_alternative_id: "time" } as never;
    const l = layout(new Map([[S("split"), chose]]), true);
    expect(l.routes.filter((r) => r.chosen && r.from !== "fork").map((r) => r.id)).toEqual([`${S("split")}#time`]);
    expect(layout(new Map([[S("split"), chose]]), false).routes.some((r) => r.chosen)).toBe(false);
  });
});
