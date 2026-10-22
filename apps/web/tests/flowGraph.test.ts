import { describe, expect, it } from "vitest";

import { flowGraph, SIZE } from "../src/views/methodology/flowGraph.ts";

const rule = (id: string, stage: string, routes: string[], status = "active") =>
  ({ id, stage, status, alternatives: routes.map((r) => ({ id: r, label: r, rationale: `why ${r}` })) }) as never;
const S = (name: string) => `m.supervised.${name}`;
const U = (name: string) => `m.unsupervised.${name}`;
const C = (name: string) => `m.common.${name}`;

const RULES = [
  rule(C("target"), "question", ["column"]),
  rule(S("split"), "split", ["random", "time"]),
  rule(S("fill"), "cleaning", ["median", "mean", "drop"]),
  rule(S("pick"), "models", []),
  rule(U("algo"), "models", ["kmeans", "dbscan"]),
];
const graph = (rules = RULES, reviews = new Map(), path = false) => flowGraph(rules, reviews, { path });
const node = (g: ReturnType<typeof flowGraph>, id: string) => g.nodes.find((n) => n.id === id)!;
/** A node's centre: every node is placed by its centre. */
const centre = (g: ReturnType<typeof flowGraph>, id: string) => {
  const n = node(g, id);
  return { x: n.position.x + n.width! / 2, y: n.position.y + n.height! / 2 };
};
const links = (g: ReturnType<typeof flowGraph>) => g.edges.map((e) => `${e.source}>${e.target}`);
const settled = (rule: string, route: string) => ({ rule, status: "settled", subject_node_id: "step", reason: `the flow's reason for ${route}`, recommended_alternative_id: route }) as never;

describe("methodology flow diagram", () => {
  it("draws each decision as a diamond and each route as a circle, from a start circle to an end circle per lane", () => {
    const g = graph();
    expect(node(g, S("split")).type).toBe("decision");
    expect(node(g, `${S("split")}#time`).type).toBe("step");
    expect(node(g, "start").type).toBe("terminal");
    expect(g.nodes.filter((n) => n.type === "terminal").map((n) => n.id)).toEqual(["start", "end:supervised", "end:unsupervised"]);
    expect(SIZE.step).toBeLessThan(SIZE.decision);
  });

  it("labels every branch out of a decision with why it is taken", () => {
    const g = graph(RULES, new Map([[S("split"), settled(S("split"), "time")]]));
    const reason = (route: string) => g.edges.find((e) => e.target === `${S("split")}#${route}`)!.data!.reason;
    expect(reason("time")).toEqual({ kind: "because", text: "the flow's reason for time" });
    expect(reason("random")).toEqual({ kind: "why", text: "why random" });
  });

  it("asks whether the question has a target on the connection that forks into the lanes", () => {
    const g = graph();
    expect(node(g, "fork").type).toBe("fork");
    const fork = g.edges.filter((e) => e.source === "fork");
    expect(fork.map((e) => [e.target, e.data!.reason!.text])).toEqual([
      [S("split"), "the question has a target"],
      [U("algo"), "the question has no target"],
    ]);
  });

  it("joins every route of a decision into the next decision, and a decision with no routes straight on", () => {
    const g = graph();
    expect(links(g)).toEqual(
      expect.arrayContaining([
        `${S("split")}#random>${S("fill")}`,
        `${S("split")}#time>${S("fill")}`,
        `${S("fill")}#drop>${S("pick")}`,
        `${S("pick")}>end:supervised`,
      ]),
    );
  });

  it("keeps each lane's decisions on one line, its circles evenly above and below, and moves only rightwards", () => {
    const g = graph();
    const lane = [S("split"), S("fill"), S("pick")].map((id) => centre(g, id));
    expect(new Set(lane.map((c) => c.y)).size).toBe(1);
    expect(lane.map((c) => c.x)).toEqual([...lane.map((c) => c.x)].sort((a, b) => a - b));
    const steps = ["median", "mean", "drop"].map((r) => centre(g, `${S("fill")}#${r}`).y);
    expect(steps[1]).toBe(lane[0]!.y);
    expect(steps[0]! - steps[1]!).toBe(steps[1]! - steps[2]!);
    expect(centre(g, U("algo")).y).not.toBe(lane[0]!.y);
  });

  it("names each stage once, above its first decision, numbered in decision order", () => {
    const g = graph();
    const band = node(g, "band:supervised:cleaning");
    expect(band.data).toMatchObject({ title: "Cleaning", code: "4" });
    expect(band.position.y).toBeLessThan(centre(g, S("fill")).y - SIZE.decision);
  });

  it("with the pipeline path on, lights the routes the flow takes and dims the rest", () => {
    const g = graph(RULES, new Map([[S("split"), settled(S("split"), "time")]]), true);
    const lit = g.edges.filter((e) => e.data?.onPath).map((e) => `${e.source}>${e.target}`);
    expect(lit).toContain(`${S("split")}>${S("split")}#time`);
    expect(lit).not.toContain(`${S("split")}>${S("split")}#random`);
    expect(node(g, `${S("split")}#random`).data).toMatchObject({ dimmed: true });
    expect(node(g, U("algo")).data).toMatchObject({ dimmed: true });
  });
});
