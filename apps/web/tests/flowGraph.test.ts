import { describe, expect, it } from "vitest";

import { chapterReached, chapters, ends, SIZE, stageFlow } from "../src/views/methodology/flowGraph.ts";
import type { OnFlow } from "../src/views/methodology/ruleTree.ts";

const rule = (id: string, stage: string, routes: string[], status = "active") =>
  ({ id, stage, status, alternatives: routes.map((r) => ({ id: r, label: r, rationale: `why ${r}` })) }) as never;
const S = (name: string) => `m.supervised.${name}`;
const U = (name: string) => `m.unsupervised.${name}`;
const C = (name: string) => `m.common.${name}`;

const RULES = [
  rule(C("target"), "question", ["column"]),
  rule(C("dupes"), "data", ["drop", "keep"]),
  rule(S("split"), "split", ["random", "time"]),
  rule(S("fill"), "cleaning", ["median", "mean", "drop"]),
  rule(S("clip"), "cleaning", ["clip", "keep"]),
  rule(S("pick"), "models", []),
  rule(U("algo"), "models", ["kmeans", "dbscan"]),
];
const chapter = (key: string) => chapters(RULES).find((c) => c.key === key)!;
const flow = (key: string, reviews = new Map(), path = false) => stageFlow(chapter(key), reviews, { path, from: "from", to: "to" });
type Flow = ReturnType<typeof stageFlow>;
const node = (f: Flow, id: string) => f.nodes.find((n) => n.id === id)!;
/** Where a node's lines meet it: a step's circle sits at the top of its box. */
const centre = (f: Flow, id: string) => {
  const n = node(f, id);
  const high = n.type === "step" ? SIZE.step.circle : n.height!;
  return { x: n.position.x + n.width! / 2, y: n.position.y + high / 2 };
};
const links = (f: Flow) => f.edges.map((e) => `${e.source}>${e.target}`);
const settled = (_rule: string, route: string): OnFlow => ({ option: route, reason: `the flow's reason for ${route}`, step: "step" });

describe("methodology flow, one stage at a time", () => {
  it("splits the rules into the shared stages, then each lane's stages, numbered in decision order", () => {
    expect(chapters(RULES).map((c) => [c.key, c.code, c.rules.length])).toEqual([
      ["question", "1", 1],
      ["data", "2", 1],
      ["supervised:split", "3", 1],
      ["supervised:cleaning", "4", 2],
      ["supervised:models", "5", 1],
      ["unsupervised:models", "3", 1],
    ]);
  });

  it("says where a stage is entered from and leads to, and that the shared stages fork on the target", () => {
    const all = chapters(RULES);
    expect(ends(all, 3)).toEqual({ from: "from Split", to: "to Models" });
    expect(ends(all, 1).to).toBe("Supervised when the question has a target; Unsupervised when the question has no target");
    expect(ends(all, 5)).toEqual({ from: "from Data", to: "Score the test rows once" });
  });

  it("draws a circle in and out, a diamond per decision and a circle per route, each route saying why", () => {
    const f = flow("supervised:cleaning", new Map([[S("fill"), settled(S("fill"), "mean")]]));
    expect(f.nodes.map((n) => n.type)).toEqual(["terminal", "decision", "step", "step", "step", "decision", "step", "step", "terminal"]);
    expect(node(f, `${S("fill")}#mean`).data).toMatchObject({ reason: { kind: "because", text: "the flow's reason for mean" }, code: "4.1b" });
    expect(node(f, `${S("fill")}#drop`).data).toMatchObject({ reason: { kind: "why", text: "why drop" } });
  });

  it("joins every route into the next decision, and a decision with no routes straight on", () => {
    expect(links(flow("supervised:cleaning"))).toEqual([
      `from>${S("fill")}`,
      `${S("fill")}>${S("fill")}#median`,
      `${S("fill")}>${S("fill")}#mean`,
      `${S("fill")}>${S("fill")}#drop`,
      `${S("fill")}#median>${S("clip")}`,
      `${S("fill")}#mean>${S("clip")}`,
      `${S("fill")}#drop>${S("clip")}`,
      `${S("clip")}>${S("clip")}#clip`,
      `${S("clip")}>${S("clip")}#keep`,
      `${S("clip")}#clip>to`,
      `${S("clip")}#keep>to`,
    ]);
    expect(links(flow("supervised:models"))).toEqual([`from>${S("pick")}`, `${S("pick")}>to`]);
  });

  it("reads top to bottom: decisions on one centre line, each route row evenly either side, below its decision", () => {
    const f = flow("supervised:cleaning");
    const spine = ["from", S("fill"), S("clip"), "to"].map((id) => centre(f, id));
    expect(new Set(spine.map((c) => c.x))).toEqual(new Set([0]));
    expect(spine.map((c) => c.y)).toEqual([...spine.map((c) => c.y)].sort((a, b) => a - b));
    const row = ["median", "mean", "drop"].map((r) => centre(f, `${S("fill")}#${r}`));
    expect(new Set(row.map((c) => c.y)).size).toBe(1);
    expect(row.map((c) => c.x)).toEqual([-200, 0, 200]);
    expect(row[0]!.y).toBeGreaterThan(spine[1]!.y);
    // The next decision starts below the routes' text, so no line crosses it.
    const box = node(f, `${S("fill")}#mean`);
    expect(centre(f, S("clip")).y - SIZE.decision / 2).toBeGreaterThan(box.position.y + box.height!);
  });

  it("with the pipeline path on, lights the route the flow takes and dims the others", () => {
    const f = stageFlow(chapter("supervised:split"), new Map([[S("split"), settled(S("split"), "time")]]), { path: true, from: "a", to: "b" });
    const lit = f.edges.filter((e) => e.data?.onPath).map((e) => `${e.source}>${e.target}`);
    expect(lit).toEqual([`from>${S("split")}`, `${S("split")}>${S("split")}#time`, `${S("split")}#time>to`]);
    expect(node(f, `${S("split")}#random`).data).toMatchObject({ dimmed: true });
  });

  it("tells the stepper whether the flow has a step a stage's decisions shaped", () => {
    expect(chapterReached(chapter("supervised:cleaning"), new Map([[S("fill"), settled(S("fill"), "median")]]))).toBe(true);
    expect(chapterReached(chapter("supervised:split"), new Map())).toBe(false);
  });
});
