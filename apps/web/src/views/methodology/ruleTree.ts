import type { MethodologyReviewItem, MethodologyRule, MethodologyStage } from "@sprisk/contracts";
import type { Edge, Node } from "@xyflow/react";

/** Decision order (ADR-0059): the split comes before cleaning, since cleaning measures train rows. */
export const STAGES: MethodologyStage[] = ["question", "data", "split", "cleaning", "features", "models", "evaluation", "reporting"];
export const stageName = (stage: MethodologyStage) => stage[0]!.toUpperCase() + stage.slice(1);

/** Sizes given up front: a tree has no need to measure its nodes before placing them. One
 * height for all, so a decision centred on its routes' tops is centred on them. */
const HEIGHT = 36;
const SIZE = { root: { width: 64, height: HEIGHT }, stage: { width: 200, height: HEIGHT }, rule: { width: 300, height: HEIGHT }, route: { width: 300, height: HEIGHT } };
const ROW = HEIGHT + 6;
const RULE_GAP = 10;
/** The trunk runs along the top; each stage's branches hang below it in the stage's column. */
const BRANCHES_TOP = 84;
const INDENT = 36;
const ROUTE_OFFSET = INDENT + SIZE.rule.width + 40;
const COLUMN_WIDTH = ROUTE_OFFSET + SIZE.route.width + 80;
const FIRST_STAGE = 130;

export type TreeNode =
  | Node<{ count: number }, "root">
  | Node<{ stage: MethodologyStage; count: number; number: number; dimmed: boolean }, "stage">
  | Node<{ rule: MethodologyRule; review: MethodologyReviewItem | undefined; dimmed: boolean }, "rule">
  | Node<{ route: MethodologyRule["alternatives"][number]; picked: boolean; dimmed: boolean }, "route">;

/** The methodology as a tree (ADR-0059), every possibility: its stages left to right in
 * decision order along a trunk, each stage's decisions hanging below it, drafts too, and each
 * decision branching right into its routes. A stage's routes are its leaves, stacked top to
 * bottom; a decision sits level with the middle of its routes. A tree has one fixed shape, so
 * it is placed directly, without a layout engine. `reviews` holds the selected flow's review
 * per rule: the route it recommends is picked. With `path`, the flow's path is marked
 * (`data.onPath` on edges): the trunk up to the last stage the flow reaches, and in each stage
 * the decisions it has a step for and their routes. All else is dimmed. View state only. */
export function ruleTree(rules: MethodologyRule[], reviews: Map<string, MethodologyReviewItem>, { path }: { path: boolean }): { nodes: TreeNode[]; edges: Edge[] } {
  const nodes: TreeNode[] = [];
  const edges: Edge<{ onPath: boolean }>[] = [];
  const middle = (ys: number[]) => (ys[0]! + ys[ys.length - 1]!) / 2;
  const onPath = (rule: MethodologyRule) => reviews.get(rule.id)?.subject_node_id !== undefined;
  // Every stage, even one with no rules yet, so the tree shows the whole methodology.
  const stages = STAGES;
  const reached = stages.reduce((last, stage, at) => (rules.some((r) => r.stage === stage && onPath(r)) ? at : last), -1);
  let previous = "root";
  stages.forEach((stage, at) => {
    const mine = rules.filter((r) => r.stage === stage);
    const stageId = `stage:${stage}`;
    const x = FIRST_STAGE + at * COLUMN_WIDTH;
    const stageOnPath = mine.some(onPath);
    edges.push({ id: `${previous}>${stageId}`, source: previous, target: stageId, data: { onPath: path && at <= reached } });
    nodes.push({ id: stageId, type: "stage", position: { x, y: 0 }, ...SIZE.stage, data: { stage, count: mine.length, number: at + 1, dimmed: path && !stageOnPath } });
    let y = BRANCHES_TOP;
    for (const rule of mine) {
      const review = reviews.get(rule.id);
      const ruleOnPath = onPath(rule);
      edges.push({ id: `${stageId}>${rule.id}`, source: stageId, sourceHandle: "branch", target: rule.id, data: { onPath: path && ruleOnPath } });
      const routeYs = rule.alternatives.map((route) => {
        const id = `${rule.id}#${route.id}`;
        const picked = review?.recommended_alternative_id === route.id;
        const taken = ruleOnPath && picked;
        nodes.push({ id, type: "route", position: { x: x + ROUTE_OFFSET, y }, ...SIZE.route, data: { route, picked, dimmed: path && !taken } });
        edges.push({ id: `${rule.id}>${id}`, source: rule.id, target: id, data: { onPath: path && taken } });
        const top = y;
        y += ROW;
        return top;
      });
      if (routeYs.length === 0) {
        routeYs.push(y);
        y += ROW;
      }
      nodes.push({ id: rule.id, type: "rule", position: { x: x + INDENT, y: middle(routeYs) }, ...SIZE.rule, data: { rule, review, dimmed: path && !ruleOnPath } });
      y += RULE_GAP;
    }
    previous = stageId;
  });
  nodes.push({ id: "root", type: "root", position: { x: 0, y: 0 }, ...SIZE.root, data: { count: rules.length } });
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
