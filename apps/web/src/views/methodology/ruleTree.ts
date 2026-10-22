import type { MethodologyReviewItem, MethodologyRule, MethodologyStage } from "@sprisk/contracts";
import type { Edge, Node } from "@xyflow/react";

/** Decision order (ADR-0059): the split comes before cleaning, since cleaning measures train rows. */
export const STAGES: MethodologyStage[] = ["question", "data", "split", "cleaning", "features", "models", "evaluation", "reporting"];
export const stageName = (stage: MethodologyStage) => stage[0]!.toUpperCase() + stage.slice(1);

/** Sizes given up front: a tree has no need to measure its nodes before placing them. One
 * height for all, so a parent centred on its children's tops is centred on them. */
const HEIGHT = 36;
const SIZE = { root: { width: 64, height: HEIGHT }, stage: { width: 170, height: HEIGHT }, rule: { width: 290, height: HEIGHT }, route: { width: 360, height: HEIGHT } };
const ROW = HEIGHT + 6;
const RULE_GAP = 8;
const GAP = 72;

type Kind = "trunk" | "branch" | "skip";

export type TreeNode =
  | Node<{ count: number }, "root">
  | Node<{ stage: MethodologyStage; count: number; number: number; dimmed: boolean }, "stage">
  | Node<{ rule: MethodologyRule; review: MethodologyReviewItem | undefined; dimmed: boolean }, "rule">
  | Node<{ route: MethodologyRule["alternatives"][number]; when: string | undefined; picked: boolean; dimmed: boolean }, "route">;

/** The methodology as a connected tree (ADR-0059), every possibility, left to right: the stages
 * in decision order on one line, each fanning out into a column of its decisions, each decision
 * into its routes, and the routes joining into the next stage. A stage's routes are stacked;
 * each decision sits level with the middle of its routes, and each stage with the middle of its
 * fan. A tree of fixed shape is placed directly, without a layout engine. `reviews` holds the
 * selected flow's review per rule: the route it recommends is picked. With `path`, the flow's
 * path is marked (`data.onPath`) up to the last stage it reaches: through the decisions it has a
 * step for and the routes it takes, and straight on (a "skip" link) from a stage it takes no
 * route in. All else is dimmed. View state only. */
export function ruleTree(rules: MethodologyRule[], reviews: Map<string, MethodologyReviewItem>, { path }: { path: boolean }): { nodes: TreeNode[]; edges: Edge[] } {
  const nodes: TreeNode[] = [];
  const edges: Edge<{ onPath: boolean; kind: Kind }>[] = [];
  const onPath = (rule: MethodologyRule) => reviews.get(rule.id)?.subject_node_id !== undefined;
  const reached = STAGES.reduce((last, stage, at) => (rules.some((r) => r.stage === stage && onPath(r)) ? at : last), -1);
  const middle = (ys: number[]) => (ys[0]! + ys[ys.length - 1]!) / 2;

  // The nodes the next stage is reached from, and whether the flow's path runs through each.
  let tails: { id: string; lit: boolean; kind: Kind }[] = [{ id: "root", lit: path && reached >= 0, kind: "trunk" }];
  nodes.push({ id: "root", type: "root", position: { x: 0, y: -HEIGHT / 2 }, ...SIZE.root, data: { count: rules.length } });
  let x = SIZE.root.width + GAP;

  STAGES.forEach((stage, number) => {
    const mine = rules.filter((r) => r.stage === stage);
    const stageId = `stage:${stage}`;
    const reach = path && number <= reached;
    for (const tail of tails) edges.push({ id: `${tail.id}>${stageId}`, source: tail.id, target: stageId, data: { onPath: tail.lit && reach, kind: tail.kind } });
    nodes.push({ id: stageId, type: "stage", position: { x, y: -HEIGHT / 2 }, ...SIZE.stage, data: { stage, count: mine.length, number: number + 1, dimmed: path && !reach } });
    x += SIZE.stage.width + GAP;
    if (mine.length === 0) {
      tails = [{ id: stageId, lit: reach, kind: "trunk" }];
      return;
    }

    // Stack the stage's routes from 0, then shift the whole fan so it is centred on the line.
    const fan: TreeNode[] = [];
    const ruleYs: number[] = [];
    const next: typeof tails = [];
    let y = 0;
    for (const rule of mine) {
      const review = reviews.get(rule.id);
      const ruleOnPath = onPath(rule);
      edges.push({ id: `${stageId}>${rule.id}`, source: stageId, target: rule.id, data: { onPath: reach && ruleOnPath, kind: "branch" } });
      const routeYs = rule.alternatives.map((route) => {
        const id = `${rule.id}#${route.id}`;
        const picked = review?.recommended_alternative_id === route.id;
        const taken = ruleOnPath && picked;
        fan.push({ id, type: "route", position: { x: x + SIZE.rule.width + GAP, y }, ...SIZE.route, data: { route, when: routeWhen(rule, route.id), picked, dimmed: path && !taken } });
        edges.push({ id: `${rule.id}>${id}`, source: rule.id, target: id, data: { onPath: reach && taken, kind: "branch" } });
        next.push({ id, lit: reach && taken, kind: "trunk" });
        const top = y;
        y += ROW;
        return top;
      });
      if (routeYs.length === 0) {
        next.push({ id: rule.id, lit: reach && ruleOnPath, kind: "trunk" });
        routeYs.push(y);
        y += ROW;
      }
      ruleYs.push(middle(routeYs));
      fan.push({ id: rule.id, type: "rule", position: { x, y: middle(routeYs) }, ...SIZE.rule, data: { rule, review, dimmed: path && !ruleOnPath } });
      y += RULE_GAP;
    }
    const shift = -HEIGHT / 2 - (y - RULE_GAP - ROW) / 2;
    for (const node of fan) nodes.push({ ...node, position: { x: node.position.x, y: node.position.y + shift } });
    x += SIZE.rule.width + GAP + SIZE.route.width + GAP;
    // The path goes straight on from a stage it takes no route in.
    tails = reach && !next.some((t) => t.lit) ? [...next, { id: stageId, lit: true, kind: "skip" }] : next;
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
    .replace(/^column\./, "")
    .replace(/[._]/g, " ");

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
    .map(([name, value]) => `${factName(name)} = ${typeof value === "object" ? value.value : String(value)}`)
    .join(" · ");
}

/** Which steps a decision activates on: the operators it decides, without pack and version. */
export function activation(rule: MethodologyRule): string | undefined {
  const steps = (rule.applies_to ?? []).map((op) => op.split(".").slice(2).join(" ").replace(/_/g, " "));
  return steps.length ? `on ${steps.join(" or ")} steps` : undefined;
}
