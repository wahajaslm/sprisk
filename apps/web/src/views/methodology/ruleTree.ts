import type { MethodologyReviewItem, MethodologyRule, MethodologyStage } from "@sprisk/contracts";
import type { Edge, Node } from "@xyflow/react";

/** Decision order (ADR-0059): the split comes before cleaning, since cleaning measures train rows. */
export const STAGES: MethodologyStage[] = ["question", "data", "split", "cleaning", "features", "models", "evaluation", "reporting"];
export const stageName = (stage: MethodologyStage) => stage[0]!.toUpperCase() + stage.slice(1);

/** Sizes given up front: a tree has no need to measure its nodes before placing them. One
 * height for all, so a parent centred on its children's tops is centred on them. */
const HEIGHT = 36;
const SIZE = { root: { width: 64, height: HEIGHT }, stage: { width: 230, height: HEIGHT }, rule: { width: 330, height: HEIGHT }, route: { width: 380, height: HEIGHT } };
const ROW = HEIGHT + 6;
const RULE_GAP = 10;
const STAGE_GAP = 26;
const COLUMN = { root: 0, stage: 150, rule: 430, route: 820 };

export type TreeNode =
  | Node<{ count: number }, "root">
  | Node<{ stage: MethodologyStage; count: number; number: number; dimmed: boolean }, "stage">
  | Node<{ rule: MethodologyRule; review: MethodologyReviewItem | undefined; dimmed: boolean }, "rule">
  | Node<{ route: MethodologyRule["alternatives"][number]; picked: boolean; dimmed: boolean }, "route">;

/** The methodology as a tree (ADR-0059): the root, its stages in decision order, every
 * decision, drafts too, and every route: all its possibilities. One column per level; the
 * routes are the leaves, stacked top to bottom, and every parent sits level with the middle of
 * its children. A tree has one fixed shape, so it is placed directly, without a layout engine.
 * `reviews` holds the selected flow's review per rule: the route it recommends is picked. With
 * `path`, the flow's path is marked (`data.onPath` on edges) and all it does not touch dimmed:
 * a decision is on the path when the flow has a step for it. View state only. */
export function ruleTree(rules: MethodologyRule[], reviews: Map<string, MethodologyReviewItem>, { path }: { path: boolean }): { nodes: TreeNode[]; edges: Edge[] } {
  const nodes: TreeNode[] = [];
  const edges: Edge<{ onPath: boolean }>[] = [];
  const middle = (ys: number[]) => (ys[0]! + ys[ys.length - 1]!) / 2;
  const onPath = (rule: MethodologyRule) => reviews.get(rule.id)?.subject_node_id !== undefined;
  const stageYs: number[] = [];
  let y = 0;
  for (const stage of STAGES) {
    const mine = rules.filter((r) => r.stage === stage);
    if (mine.length === 0) continue;
    const stageId = `stage:${stage}`;
    const stageOnPath = mine.some(onPath);
    edges.push({ id: `root>${stageId}`, source: "root", target: stageId, data: { onPath: path && stageOnPath } });
    const ruleYs: number[] = [];
    for (const rule of mine) {
      const review = reviews.get(rule.id);
      const ruleOnPath = onPath(rule);
      edges.push({ id: `${stageId}>${rule.id}`, source: stageId, target: rule.id, data: { onPath: path && ruleOnPath } });
      const routeYs = rule.alternatives.map((route) => {
        const id = `${rule.id}#${route.id}`;
        const picked = review?.recommended_alternative_id === route.id;
        const taken = ruleOnPath && picked;
        nodes.push({ id, type: "route", position: { x: COLUMN.route, y }, ...SIZE.route, data: { route, picked, dimmed: path && !taken } });
        edges.push({ id: `${rule.id}>${id}`, source: rule.id, target: id, data: { onPath: path && taken } });
        const at = y;
        y += ROW;
        return at;
      });
      if (routeYs.length === 0) {
        routeYs.push(y);
        y += ROW;
      }
      const ruleY = middle(routeYs);
      ruleYs.push(ruleY);
      nodes.push({ id: rule.id, type: "rule", position: { x: COLUMN.rule, y: ruleY }, ...SIZE.rule, data: { rule, review, dimmed: path && !ruleOnPath } });
      y += RULE_GAP;
    }
    const stageY = middle(ruleYs);
    stageYs.push(stageY);
    nodes.push({ id: stageId, type: "stage", position: { x: COLUMN.stage, y: stageY }, ...SIZE.stage, data: { stage, count: mine.length, number: stageYs.length, dimmed: path && !stageOnPath } });
    y += STAGE_GAP;
  }
  const rootY = stageYs.length ? middle(stageYs) : 0;
  nodes.push({ id: "root", type: "root", position: { x: COLUMN.root, y: rootY }, ...SIZE.root, data: { count: rules.length } });
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
