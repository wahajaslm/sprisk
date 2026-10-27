import type { MethodologyRule, MethodologyStage } from "@sprisk/contracts";
import type { Edge, Node } from "@xyflow/react";

import { LANE_NOTE, type OnFlow, packOf, type RouteReason, routeReason, STAGES } from "./ruleTree.ts";

/** Sizes and distances, centre to centre where it says so. A stage reads top to bottom: each
 * decision on the middle line, its routes in one row under it, evenly either side, each route's
 * name and reason under its circle, so no line ever crosses text. */
export const SIZE = { terminal: 30, decision: 34, step: { width: 180, height: 86, circle: 22 } } as const;
const TO_STEPS = 110;
const STEP_DX = 200;
const TO_NEXT = 92;

/** Stages every methodology goes through before the lanes fork. */
const SHARED: MethodologyStage[] = ["question", "data"];
const LANE_ORDER = ["supervised", "unsupervised"];

/** One stage of one lane, as the stepper shows it. Shared stages have no lane. */
export type Chapter = { key: string; lane: string | undefined; stage: MethodologyStage; code: string; rules: MethodologyRule[] };

export type FlowEdgeData = { onPath: boolean; kind: "trunk" | "branch" | "skip" };

export type FlowNode =
  | Node<{ label: string; dimmed: boolean }, "terminal">
  | Node<{ rule: MethodologyRule; decided: OnFlow | undefined; code: string; dimmed: boolean }, "decision">
  | Node<{ route: MethodologyRule["alternatives"][number]; reason: RouteReason; code: string; picked: boolean; dimmed: boolean }, "step">;

type Tail = { id: string; lit: boolean; kind: FlowEdgeData["kind"] };

const stageTitle = (stage: MethodologyStage) => stage[0]!.toUpperCase() + stage.slice(1);
const laneTitle = (lane: string) => lane[0]!.toUpperCase() + lane.slice(1);

/** The stages in decision order: the shared question and data stages, then each lane's own,
 * numbered on from the shared ones. Every rule is in exactly one. */
export function chapters(rules: MethodologyRule[]): Chapter[] {
  // Numbered as the tree numbers them, whichever stages hold rules.
  const shared = SHARED.filter((s) => rules.some((r) => r.stage === s)).map((stage) => ({ key: stage, lane: undefined, stage, code: `${SHARED.indexOf(stage) + 1}`, rules: rules.filter((r) => r.stage === stage) }));
  const lanes = [...new Set(rules.filter((r) => !SHARED.includes(r.stage)).map(packOf))].sort(
    (p, q) => (LANE_ORDER.indexOf(p) + 1 || 99) - (LANE_ORDER.indexOf(q) + 1 || 99) || p.localeCompare(q),
  );
  const own = lanes.flatMap((lane) =>
    STAGES.filter((s) => !SHARED.includes(s) && rules.some((r) => r.stage === s && packOf(r) === lane)).map((stage, i) => ({
      key: `${lane}:${stage}`,
      lane,
      stage,
      code: `${SHARED.length + i + 1}`,
      rules: rules.filter((r) => r.stage === stage && packOf(r) === lane),
    })),
  );
  return [...shared, ...own];
}

/** Where a stage is entered from and leads to, in words: the stage before and after it in its
 * lane, or, after the shared stages, the fork on whether the question has a target. */
export function ends(all: Chapter[], at: number): { from: string; to: string } {
  const chapter = all[at]!;
  const lane = (c: Chapter | undefined) => c?.lane;
  const before = all.slice(0, at).reverse().find((c) => c.lane === undefined || c.lane === chapter.lane);
  const after = all.slice(at + 1).find((c) => c.lane === chapter.lane);
  const from = before ? `from ${stageTitle(before.stage)}` : "Question and data";
  if (after) return { from, to: `to ${stageTitle(after.stage)}` };
  if (chapter.lane === undefined) {
    const forks = [...new Set(all.map(lane).filter((l): l is string => l !== undefined))];
    return { from, to: forks.map((l) => `${laneTitle(l)} when ${LANE_NOTE[l] ?? `the ${l} pack`}`).join("; ") || "Score the test rows once" };
  }
  return { from, to: "Score the test rows once" };
}

/** One stage as a flow diagram, top to bottom: a circle it is entered from, a diamond for each
 * decision, a circle for each route under it saying why it is taken (the selected flow's own
 * reason, else the route's condition, else its rationale), and a circle it leads to. Every
 * route joins the next decision. Ids match the tree's, so one selection serves both views.
 * With `path`, the routes the flow takes are lit and the rest dimmed. */
export function stageFlow(
  chapter: Chapter,
  decided: Map<string, OnFlow>,
  { path, from, to }: { path: boolean; from: string; to: string },
): { nodes: FlowNode[]; edges: Edge<FlowEdgeData>[] } {
  const nodes: FlowNode[] = [];
  const edges: Edge<FlowEdgeData>[] = [];
  const centred = (cx: number, cy: number, w: number, h: number) => ({ x: cx - w / 2, y: cy - h / 2 });
  const onPath = (rule: MethodologyRule) => decided.get(rule.id)?.step !== undefined;
  const reach = path && chapter.rules.some(onPath);
  const link = (tails: Tail[], target: string) => {
    for (const t of tails) edges.push({ id: `${t.id}>${target}`, source: t.id, target, data: { onPath: t.lit, kind: t.kind }, className: `mth-flow-edge ${t.kind}${t.lit ? " path" : ""}` });
  };

  nodes.push({ id: "from", type: "terminal", position: centred(0, 0, SIZE.terminal, SIZE.terminal), width: SIZE.terminal, height: SIZE.terminal, data: { label: from, dimmed: path && !reach } });
  let tails: Tail[] = [{ id: "from", lit: reach, kind: "trunk" }];
  let y = SIZE.terminal / 2 + TO_NEXT;

  chapter.rules.forEach((rule, k) => {
    const chosen = decided.get(rule.id);
    const ruleOnPath = onPath(rule);
    const ruleCode = `${chapter.code}.${k + 1}`;
    link(tails, rule.id);
    nodes.push({ id: rule.id, type: "decision", position: centred(0, y, SIZE.decision, SIZE.decision), width: SIZE.decision, height: SIZE.decision, data: { rule, decided: chosen, code: ruleCode, dimmed: path && !ruleOnPath } });
    const routes = rule.alternatives;
    if (routes.length === 0) {
      tails = [{ id: rule.id, lit: reach && ruleOnPath, kind: "trunk" }];
      y += SIZE.decision + TO_NEXT;
      return;
    }
    const row = y + TO_STEPS;
    tails = routes.map((route, i) => {
      const id = `${rule.id}#${route.id}`;
      const picked = chosen?.option === route.id;
      const taken = reach && ruleOnPath && picked;
      const cx = (i - (routes.length - 1) / 2) * STEP_DX;
      nodes.push({
        id,
        type: "step",
        // The circle's centre is on the row; the name and reason hang below it.
        position: { x: cx - SIZE.step.width / 2, y: row - SIZE.step.circle / 2 },
        width: SIZE.step.width,
        height: SIZE.step.height,
        data: { route, reason: routeReason(rule, route, chosen), code: `${ruleCode}${String.fromCharCode(97 + i)}`, picked, dimmed: path && !(ruleOnPath && picked) },
      });
      edges.push({ id: `${rule.id}>${id}`, source: rule.id, target: id, data: { onPath: taken, kind: "branch" }, className: `mth-flow-edge branch${taken ? " path" : ""}` });
      return { id, lit: taken, kind: "trunk" as const };
    });
    // The path goes straight on past a decision it takes no route of.
    if (reach && !tails.some((t) => t.lit)) tails.push({ id: rule.id, lit: true, kind: "skip" });
    y = row - SIZE.step.circle / 2 + SIZE.step.height + TO_NEXT;
  });

  nodes.push({ id: "to", type: "terminal", position: centred(0, y, SIZE.terminal, SIZE.terminal), width: SIZE.terminal, height: SIZE.terminal, data: { label: to, dimmed: path && !reach } });
  link(tails, "to");
  return { nodes, edges };
}

/** Whether the selected flow has a step any of the stage's decisions shaped. */
export function chapterReached(chapter: Chapter, decided: Map<string, OnFlow>): boolean {
  return chapter.rules.some((r) => decided.get(r.id)?.step !== undefined);
}
