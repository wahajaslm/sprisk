import type { MethodologyReviewItem, MethodologyRule, MethodologyStage } from "@sprisk/contracts";
import type { Edge, Node } from "@xyflow/react";

/** Decision order (ADR-0059): the split comes before cleaning, since cleaning measures train rows. */
export const STAGES: MethodologyStage[] = ["question", "data", "split", "cleaning", "features", "models", "evaluation", "reporting"];
export const stageName = (stage: MethodologyStage) => stage[0]!.toUpperCase() + stage.slice(1);

/** Sizes given up front: a tree has no need to measure its nodes before placing them. A route
 * grows to fit its condition, wrapped onto up to three lines; every other node has one height. */
const HEIGHT = 36;
const SIZE = { root: { width: 64 }, stage: { width: 180 }, rule: { width: 300 }, route: { width: 340 } };
const WHEN_LINE = 15;
const WHEN_LINES = 3;
/** Characters of the condition's monospace text that fit one line of a route. */
const WHEN_CHARS = 48;
const ROUTE_GAP = 6;
const RULE_GAP = 10;
const GAP = 72;
const LANE_GAP = 96;
/** Stages every methodology goes through before the lanes fork. */
const SHARED: MethodologyStage[] = ["question", "data"];
/** Lanes in this order first; any other pack follows by name. */
const LANE_ORDER = ["supervised", "unsupervised"];

type Kind = "trunk" | "branch" | "skip";
type Tail = { id: string; lit: boolean; kind: Kind };

export type TreeNode =
  | Node<{ count: number }, "root">
  | Node<{ lane: string; code: string; dimmed: boolean }, "lane">
  | Node<{ stage: MethodologyStage; count: number; code: string; dimmed: boolean }, "stage">
  | Node<{ rule: MethodologyRule; review: MethodologyReviewItem | undefined; code: string; dimmed: boolean }, "rule">
  | Node<{ route: MethodologyRule["alternatives"][number]; when: string | undefined; code: string; picked: boolean; dimmed: boolean }, "route">;

/** The pack a rule comes from (`methodology/<pack>/`), named in its id. */
const packOf = (rule: MethodologyRule) => rule.id.split(".")[1] ?? "";

const routeHeight = (when: string | undefined) => (when ? 24 + Math.min(WHEN_LINES, Math.ceil(when.length / WHEN_CHARS)) * WHEN_LINE + 6 : HEIGHT);

/** The methodology as a connected tree (ADR-0059), every possibility, left to right. The
 * question and data stages are shared; then the tree forks into one lane per pack (supervised:
 * the question has a target; unsupervised: it has none). In each lane the stages run in
 * decision order on one line, each fanning out into its decisions, each decision into its
 * routes, and the routes join into the next stage. Every node is numbered: stage "4",
 * decision "4.1", route "4.1a". A tree of fixed shape is placed directly, without a layout
 * engine. `reviews` holds the selected flow's review per rule: the route it recommends is
 * picked. With `path`, the flow's path is marked (`data.onPath`): its lane, up to the last stage
 * it reaches, through the decisions it has a step for and the routes it takes, and straight on
 * (a "skip" link) from a stage it takes no route in. All else is dimmed. View state only. */
/** Where a route's branches meet it: the middle of its label line, which the stylesheet puts
 * 16px from its top (8px padding, then a 15px line). */
export const ROUTE_LINE = 16;

export function ruleTree(rules: MethodologyRule[], reviews: Map<string, MethodologyReviewItem>, { path }: { path: boolean }): { nodes: TreeNode[]; edges: Edge[] } {
  const nodes: TreeNode[] = [];
  const edges: Edge<{ onPath: boolean; kind: Kind }>[] = [];
  const onPath = (rule: MethodologyRule) => reviews.get(rule.id)?.subject_node_id !== undefined;
  const link = (tails: Tail[], target: string, reach: boolean) => {
    for (const tail of tails) edges.push({ id: `${tail.id}>${target}`, source: tail.id, target, data: { onPath: tail.lit && reach, kind: tail.kind } });
  };
  const fanHeight = (mine: MethodologyRule[]) =>
    mine.reduce((h, rule) => h + Math.max(HEIGHT, rule.alternatives.reduce((r, a) => r + routeHeight(routeWhen(rule, a.id)) + ROUTE_GAP, -ROUTE_GAP)) + RULE_GAP, -RULE_GAP);

  /** Places one stage centred on `centre` at `x`: its node, then its fan. Returns the tails the
   * next stage is reached from and the x after it. */
  const stage = (stageId: string, stageName: MethodologyStage, code: string, mine: MethodologyRule[], x: number, centre: number, reach: boolean, tails: Tail[]) => {
    link(tails, stageId, reach);
    nodes.push({ id: stageId, type: "stage", position: { x, y: centre - HEIGHT / 2 }, width: SIZE.stage.width, height: HEIGHT, data: { stage: stageName, count: mine.length, code, dimmed: path && !reach } });
    x += SIZE.stage.width + GAP;
    if (mine.length === 0) return { tails: [{ id: stageId, lit: reach, kind: "trunk" as Kind }], x };

    const next: Tail[] = [];
    let y = centre - fanHeight(mine) / 2;
    mine.forEach((rule, k) => {
      const review = reviews.get(rule.id);
      const ruleOnPath = onPath(rule);
      const ruleCode = `${code}.${k + 1}`;
      edges.push({ id: `${stageId}>${rule.id}`, source: stageId, target: rule.id, data: { onPath: reach && ruleOnPath, kind: "branch" } });
      const top = y;
      const lines = rule.alternatives.map((route, i) => {
        const id = `${rule.id}#${route.id}`;
        const when = routeWhen(rule, route.id);
        const height = routeHeight(when);
        const picked = review?.recommended_alternative_id === route.id;
        const taken = ruleOnPath && picked;
        nodes.push({ id, type: "route", position: { x: x + SIZE.rule.width + GAP, y }, width: SIZE.route.width, height, data: { route, when, code: `${ruleCode}${String.fromCharCode(97 + i)}`, picked, dimmed: path && !taken } });
        edges.push({ id: `${rule.id}>${id}`, source: rule.id, target: id, data: { onPath: reach && taken, kind: "branch" } });
        next.push({ id, lit: reach && taken, kind: "trunk" });
        // Branches meet a route at its label line, the top row, above its wrapped condition.
        const line = y + ROUTE_LINE;
        y += height + ROUTE_GAP;
        return line;
      });
      if (lines.length === 0) {
        next.push({ id: rule.id, lit: reach && ruleOnPath, kind: "trunk" });
        lines.push(y + HEIGHT / 2);
        y += HEIGHT + ROUTE_GAP;
      }
      const middle = (lines[0]! + lines[lines.length - 1]!) / 2;
      nodes.push({ id: rule.id, type: "rule", position: { x, y: middle - HEIGHT / 2 }, width: SIZE.rule.width, height: HEIGHT, data: { rule, review, code: ruleCode, dimmed: path && !ruleOnPath } });
      y = Math.max(y, top + HEIGHT + ROUTE_GAP) - ROUTE_GAP + RULE_GAP;
    });
    x += SIZE.rule.width + GAP + SIZE.route.width + GAP;
    // The path goes straight on from a stage it takes no route in.
    const tailsOut = reach && !next.some((t) => t.lit) ? [...next, { id: stageId, lit: true, kind: "skip" as Kind }] : next;
    return { tails: tailsOut, x };
  };

  const lanes = [...new Set(rules.filter((r) => !SHARED.includes(r.stage)).map(packOf))].sort(
    (p, q) => (LANE_ORDER.indexOf(p) + 1 || 99) - (LANE_ORDER.indexOf(q) + 1 || 99) || p.localeCompare(q),
  );
  const laneStages = (lane: string) => STAGES.filter((s) => !SHARED.includes(s) && rules.some((r) => r.stage === s && packOf(r) === lane));
  const laneRules = (lane: string, s: MethodologyStage) => rules.filter((r) => r.stage === s && packOf(r) === lane);
  const laneReached = (lane: string) => laneStages(lane).reduce((last, s, at) => (laneRules(lane, s).some(onPath) ? at : last), -1);
  const anyOnPath = rules.some(onPath);

  // Shared stages on the middle line.
  nodes.push({ id: "root", type: "root", position: { x: 0, y: -HEIGHT / 2 }, width: SIZE.root.width, height: HEIGHT, data: { count: rules.length } });
  let tails: Tail[] = [{ id: "root", lit: path && anyOnPath, kind: "trunk" }];
  let x = SIZE.root.width + GAP;
  SHARED.forEach((s, at) => {
    const placed = stage(`stage:${s}`, s, `${at + 1}`, rules.filter((r) => r.stage === s), x, 0, path && anyOnPath, tails);
    tails = placed.tails;
    x = placed.x;
  });

  // Lanes stacked around the middle line, each as tall as its tallest fan.
  const spans = lanes.map((lane) => Math.max(HEIGHT, ...laneStages(lane).map((s) => fanHeight(laneRules(lane, s)))));
  let top = -(spans.reduce((a, b) => a + b, 0) + LANE_GAP * (lanes.length - 1)) / 2;
  const forkTails = tails;
  lanes.forEach((lane, i) => {
    const centre = top + spans[i]! / 2;
    top += spans[i]! + LANE_GAP;
    const reached = laneReached(lane);
    const laneId = `lane:${lane}`;
    link(forkTails, laneId, path && reached >= 0);
    nodes.push({ id: laneId, type: "lane", position: { x, y: centre - HEIGHT / 2 }, width: SIZE.stage.width, height: HEIGHT, data: { lane, code: "", dimmed: path && reached < 0 } });
    let laneTails: Tail[] = [{ id: laneId, lit: path && reached >= 0, kind: "trunk" }];
    let laneX = x + SIZE.stage.width + GAP;
    laneStages(lane).forEach((s, at) => {
      const placed = stage(`stage:${lane}:${s}`, s, `${SHARED.length + at + 1}`, laneRules(lane, s), laneX, centre, path && at <= reached, laneTails);
      laneTails = placed.tails;
      laneX = placed.x;
    });
  });
  return { nodes, edges };
}

const OPEN: MethodologyReviewItem["status"][] = ["proposal", "needs_fact", "needs_run", "waiting"];

/** One review item per rule, for its node: a rule deciding several steps shows its first open
 * item, where work is needed, or its first item when none is open. */
export function reviewByRule(items: MethodologyReviewItem[]): Map<string, MethodologyReviewItem> {
  const byRule = new Map<string, MethodologyReviewItem>();
  for (const item of items) {
    const shown = byRule.get(item.rule);
    if (!shown || (!OPEN.includes(shown.status) && OPEN.includes(item.status))) byRule.set(item.rule, item);
  }
  return byRule;
}

/** A fact's name as people read it: `question.time_column` → "time column",
 * `column.age.missing_share` → "age missing share". */
const factName = (name: string) =>
  name
    .replace(/^(question|flow|step|candidate)\./, "")
    .replace(/^(input\.)?column\./, "")
    .replace(/[._]/g, " ");

type Given = NonNullable<MethodologyRule["examples"]>[number]["given"][string];

/** An example's fact value as text: a list of dataset values joined, a fact with its origin
 * shown as its value only. */
export const givenText = (value: Given): string =>
  Array.isArray(value) ? value.join(", ") : typeof value === "object" ? value.value : String(value);

/** When a route is taken. A draft's route has its written condition. An active rule's logic is
 * its decide() alone (ADR-0045), so its route shows the first tested example that picks it, in
 * plain words, leaving out the target's name, which never decides a route. */
export function routeWhen(rule: MethodologyRule, routeId: string): string | undefined {
  const route = rule.alternatives.find((a) => a.id === routeId);
  if (route?.condition) return route.condition;
  const example = (rule.examples ?? []).find((e) => e.picks === routeId);
  if (!example) return undefined;
  return Object.entries(example.given)
    .filter(([name]) => name !== "question.target")
    .map(([name, value]) => `${factName(name)} = ${givenText(value)}`)
    .join(" · ");
}

/** Which steps a decision activates on: the operators it decides, without pack and version. */
export function activation(rule: MethodologyRule): string | undefined {
  const steps = (rule.applies_to ?? []).map((op) => op.split(".").slice(2).join(" ").replace(/_/g, " "));
  return steps.length ? `on ${steps.join(" or ")} steps` : undefined;
}
