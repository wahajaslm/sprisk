import type { MethodologyReviewItem, MethodologyRule, MethodologyStage } from "@sprisk/contracts";
import type { Edge, Node } from "@xyflow/react";

import { LANE_NOTE, packOf, type RouteReason, routeReason, STAGES } from "./ruleTree.ts";

/** Centre-to-centre distances. Every decision of a lane sits on the lane's one line, and its
 * steps fan out evenly above and below it, so the eye can follow each lane straight across. */
const TO_STEPS = 230;
const TO_NEXT = 210;
const STEP_DY = 76;
const LANE_PAD = 110;
const BAND_ABOVE = 46;
export const SIZE = { terminal: 30, decision: 34, step: 22 } as const;
/** Stages every methodology goes through before the lanes fork. */
const SHARED: MethodologyStage[] = ["question", "data"];
const LANE_ORDER = ["supervised", "unsupervised"];

export type FlowEdgeData = { reason: RouteReason | undefined; onPath: boolean; kind: "trunk" | "branch" | "skip"; pick: string | undefined };

export type FlowNode =
  | Node<{ label: string; dimmed: boolean }, "terminal">
  | Node<{ question: string; dimmed: boolean }, "fork">
  | Node<{ title: string; code: string; dimmed: boolean }, "band">
  | Node<{ rule: MethodologyRule; review: MethodologyReviewItem | undefined; code: string; dimmed: boolean }, "decision">
  | Node<{ route: MethodologyRule["alternatives"][number]; code: string; picked: boolean; dimmed: boolean }, "step">;

type Tail = { id: string; lit: boolean; kind: FlowEdgeData["kind"] };

/** The methodology as a flow diagram (ADR-0059): circles are steps, a diamond on each
 * connection is the decision a rule makes there, and each curved branch out of a diamond says
 * why it is taken (the selected flow's own reason, else the route's condition, else its
 * rationale). Shared question and data decisions run on the middle line; a diamond then asks
 * whether the question has a target and forks into one lane per pack. Ids match the tree's, so
 * one selection serves both views. With `path`, the flow's path is lit and the rest dimmed. */
export function flowGraph(rules: MethodologyRule[], reviews: Map<string, MethodologyReviewItem>, { path }: { path: boolean }): { nodes: FlowNode[]; edges: Edge<FlowEdgeData>[] } {
  const nodes: FlowNode[] = [];
  const edges: Edge<FlowEdgeData>[] = [];
  const at = (cx: number, cy: number, size: number) => ({ x: cx - size / 2, y: cy - size / 2 });
  const onPath = (rule: MethodologyRule) => reviews.get(rule.id)?.subject_node_id !== undefined;
  const link = (tails: Tail[], target: string, reach: boolean, reason?: RouteReason) => {
    for (const tail of tails) edges.push({ id: `${tail.id}>${target}`, source: tail.id, target, type: "reason", data: { reason, onPath: tail.lit && reach, kind: tail.kind, pick: undefined } });
  };
  const stagesOf = (mine: MethodologyRule[]) => STAGES.filter((s) => mine.some((r) => r.stage === s));
  const half = (mine: MethodologyRule[]) => Math.max(0, ...mine.map((r) => ((r.alternatives.length - 1) * STEP_DY) / 2));
  const anyOnPath = rules.some(onPath);

  /** Lays one line of decisions from `x` on `y`. `reachedStage` is the last stage of `stages`
   * the flow reaches. Returns the tails the next node joins and the x after the line. */
  const line = (mine: MethodologyRule[], firstCode: number, x: number, y: number, tails: Tail[], reachedStage: number) => {
    const top = y - half(mine) - BAND_ABOVE;
    stagesOf(mine).forEach((stage, s) => {
      const reach = path && s <= reachedStage;
      const code = `${firstCode + s}`;
      const inStage = mine.filter((r) => r.stage === stage);
      nodes.push({ id: `band:${packOf(inStage[0]!)}:${stage}`, type: "band", position: { x: x - SIZE.decision / 2, y: top }, data: { title: stage[0]!.toUpperCase() + stage.slice(1), code, dimmed: path && !reach }, selectable: false });
      inStage.forEach((rule, k) => {
        const review = reviews.get(rule.id);
        const ruleOnPath = onPath(rule);
        const ruleCode = `${code}.${k + 1}`;
        link(tails, rule.id, reach);
        nodes.push({ id: rule.id, type: "decision", position: at(x, y, SIZE.decision), width: SIZE.decision, height: SIZE.decision, data: { rule, review, code: ruleCode, dimmed: path && !ruleOnPath } });
        const routes = rule.alternatives;
        if (routes.length === 0) {
          tails = [{ id: rule.id, lit: reach && ruleOnPath, kind: "trunk" }];
          x += TO_NEXT;
          return;
        }
        tails = routes.map((route, i) => {
          const id = `${rule.id}#${route.id}`;
          const picked = review?.recommended_alternative_id === route.id;
          const taken = reach && ruleOnPath && picked;
          const cy = y + (i - (routes.length - 1) / 2) * STEP_DY;
          nodes.push({ id, type: "step", position: at(x + TO_STEPS, cy, SIZE.step), width: SIZE.step, height: SIZE.step, data: { route, code: `${ruleCode}${String.fromCharCode(97 + i)}`, picked, dimmed: path && !(ruleOnPath && picked) } });
          edges.push({ id: `${rule.id}>${id}`, source: rule.id, target: id, type: "reason", data: { reason: routeReason(rule, route, review), onPath: taken, kind: "branch", pick: id } });
          return { id, lit: taken, kind: "trunk" as const };
        });
        // The path goes straight on past a decision it takes no route of.
        if (reach && !tails.some((t) => t.lit)) tails.push({ id: rule.id, lit: true, kind: "skip" });
        x += TO_STEPS + TO_NEXT;
      });
    });
    return { tails, x };
  };

  const shared = rules.filter((r) => SHARED.includes(r.stage));
  const lanes = [...new Set(rules.filter((r) => !SHARED.includes(r.stage)).map(packOf))].sort(
    (p, q) => (LANE_ORDER.indexOf(p) + 1 || 99) - (LANE_ORDER.indexOf(q) + 1 || 99) || p.localeCompare(q),
  );
  const laneRules = (lane: string) => rules.filter((r) => !SHARED.includes(r.stage) && packOf(r) === lane);
  const reachedIn = (mine: MethodologyRule[]) => stagesOf(mine).reduce((last, s, i) => (mine.some((r) => r.stage === s && onPath(r)) ? i : last), -1);

  nodes.push({ id: "start", type: "terminal", position: at(0, 0, SIZE.terminal), width: SIZE.terminal, height: SIZE.terminal, data: { label: "Question and data", dimmed: false } });
  const sharedLine = line(shared, 1, TO_NEXT, 0, [{ id: "start", lit: path && anyOnPath, kind: "trunk" }], path && anyOnPath ? stagesOf(shared).length - 1 : -1);
  if (lanes.length === 0) return { nodes, edges };

  // The fork is a decision too: whether the question has a target.
  const forkX = sharedLine.x;
  nodes.push({ id: "fork", type: "fork", position: at(forkX, 0, SIZE.decision), width: SIZE.decision, height: SIZE.decision, data: { question: "Does the question have a target?", dimmed: path && !anyOnPath } });
  link(sharedLine.tails, "fork", path && anyOnPath);

  const spans = lanes.map((lane) => half(laneRules(lane)) * 2 + LANE_PAD * 2);
  let top = -spans.reduce((a, b) => a + b, 0) / 2;
  lanes.forEach((lane, i) => {
    const y = top + spans[i]! / 2;
    top += spans[i]!;
    const mine = laneRules(lane);
    const reached = path ? reachedIn(mine) : -1;
    const into: Tail[] = [{ id: "fork", lit: path && reached >= 0, kind: "branch" }];
    const first = mine[0];
    if (!first) return;
    const lit = (target: string) => edges.push({ id: `fork>${target}`, source: "fork", target, type: "reason", data: { reason: { kind: "when", text: LANE_NOTE[lane] ?? `the ${lane} pack` }, onPath: into[0]!.lit, kind: "branch", pick: undefined } });
    lit(first.id);
    // The lane's line starts at its first decision, joined from the fork above.
    const laneLine = line(mine, SHARED.length + 1, forkX + TO_STEPS, y, [], reached);
    const endId = `end:${lane}`;
    nodes.push({ id: endId, type: "terminal", position: at(laneLine.x, y, SIZE.terminal), width: SIZE.terminal, height: SIZE.terminal, data: { label: "Score the test rows once", dimmed: path && reached < 0 } });
    link(laneLine.tails, endId, path && reached >= 0);
  });
  return { nodes, edges };
}
