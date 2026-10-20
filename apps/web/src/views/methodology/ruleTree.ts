import type { MethodologyRule, MethodologyStage } from "@sprisk/contracts";
import type { Edge, Node } from "@xyflow/react";

/** ADR-0042: stages run in this order. */
export const STAGES: MethodologyStage[] = ["question", "data", "cleaning", "split", "features", "models", "evaluation", "reporting"];
export const stageName = (stage: MethodologyStage) => stage[0]!.toUpperCase() + stage.slice(1);

export const RULE_SIZE = { width: 300, height: 52 };
/** Sizes given up front: a tree has no need to measure its nodes before placing them. */
const SIZE = { root: { width: 150, height: 52 }, stage: { width: 170, height: 52 }, rule: RULE_SIZE };
const ROW = RULE_SIZE.height + 12;
const STAGE_GAP = 28;
const COLUMN = { root: 0, stage: 220, rule: 470 };

export type TreeNode =
  | Node<{ count: number }, "root">
  | Node<{ stage: MethodologyStage; count: number }, "stage">
  | Node<{ rule: MethodologyRule }, "rule">;

/** Methodology, then each stage with rules, then its rules: one column per level, rules
 * stacked in stage order and each parent level with the middle of its children. A tree has
 * one fixed shape, so it is placed directly, without a layout engine. View state only. */
export function ruleTree(rules: MethodologyRule[]): { nodes: TreeNode[]; edges: Edge[] } {
  const nodes: TreeNode[] = [];
  const edges: Edge[] = [];
  const middles: number[] = [];
  let y = 0;
  for (const stage of STAGES) {
    const mine = rules.filter((r) => r.stage === stage);
    if (mine.length === 0) continue;
    const stageId = `stage:${stage}`;
    edges.push({ id: `root>${stageId}`, source: "root", target: stageId });
    const ys = mine.map((rule) => {
      const at = y;
      nodes.push({ id: rule.id, type: "rule", position: { x: COLUMN.rule, y: at }, ...SIZE.rule, data: { rule } });
      edges.push({ id: `${stageId}>${rule.id}`, source: stageId, target: rule.id });
      y += ROW;
      return at;
    });
    const middle = (ys[0]! + ys[ys.length - 1]!) / 2;
    middles.push(middle);
    nodes.push({ id: stageId, type: "stage", position: { x: COLUMN.stage, y: middle }, ...SIZE.stage, data: { stage, count: mine.length } });
    y += STAGE_GAP;
  }
  const rootY = middles.length ? (middles[0]! + middles[middles.length - 1]!) / 2 : 0;
  nodes.push({ id: "root", type: "root", position: { x: COLUMN.root, y: rootY }, ...SIZE.root, data: { count: rules.length } });
  return { nodes, edges };
}
