import type { MethodologyReviewItem, MethodologyRule, MethodologyStage } from "@sprisk/contracts";
import type { Edge, Node } from "@xyflow/react";

/** Decision order (ADR-0059): the split comes before cleaning, since cleaning measures train rows. */
export const STAGES: MethodologyStage[] = ["question", "data", "split", "cleaning", "features", "models", "evaluation", "reporting"];
export const stageName = (stage: MethodologyStage) => stage[0]!.toUpperCase() + stage.slice(1);

/** Sizes given up front: every card's height follows from its number of routes, so the map
 * is placed directly, without measuring or a layout engine. */
const BOX_WIDTH = 340;
const BOX_GAP = 72;
const BOX_HEAD = 56;
const BOX_PAD = 12;
const CARD_WIDTH = BOX_WIDTH - 2 * BOX_PAD;
const CARD_HEAD = 58;
const ROUTE_ROW = 40;
const CARD_GAP = 12;

export type TreeNode =
  | Node<{ stage: MethodologyStage; count: number; number: number }, "stage">
  | Node<{ rule: MethodologyRule; review: MethodologyReviewItem | undefined }, "decision">;

/** Each stage with rules as a box, left to right in decision order, holding its decisions as
 * cards stacked top to bottom. A card lists its routes, so it grows with them. `reviews` holds
 * the selected flow's review item for each rule id. View state only. */
export function ruleTree(rules: MethodologyRule[], reviews: Map<string, MethodologyReviewItem>): { nodes: TreeNode[]; edges: Edge[] } {
  const nodes: TreeNode[] = [];
  const edges: Edge[] = [];
  let previous: string | undefined;
  let x = 0;
  for (const stage of STAGES) {
    const mine = rules.filter((r) => r.stage === stage);
    if (mine.length === 0) continue;
    const boxId = `stage:${stage}`;
    const cards: TreeNode[] = [];
    let y = BOX_HEAD;
    for (const rule of mine) {
      const height = CARD_HEAD + rule.alternatives.length * ROUTE_ROW;
      cards.push({
        id: rule.id,
        type: "decision",
        parentId: boxId,
        extent: "parent",
        position: { x: BOX_PAD, y },
        width: CARD_WIDTH,
        height,
        data: { rule, review: reviews.get(rule.id) },
      });
      y += height + CARD_GAP;
    }
    const number = nodes.filter((n) => n.type === "stage").length + 1;
    // A parent goes before its children, as React Flow requires.
    nodes.push({ id: boxId, type: "stage", position: { x, y: 0 }, width: BOX_WIDTH, height: y - CARD_GAP + BOX_PAD, data: { stage, count: mine.length, number } }, ...cards);
    if (previous) edges.push({ id: `${previous}>${boxId}`, source: previous, target: boxId });
    previous = boxId;
    x += BOX_WIDTH + BOX_GAP;
  }
  return { nodes, edges };
}
