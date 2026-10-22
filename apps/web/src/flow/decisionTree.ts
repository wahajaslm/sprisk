import type { MethodologyReviewItem, MethodologyRule, MethodologyStage } from "@sprisk/contracts";
import type { Edge, Node } from "@xyflow/react";
import ELK, { type ElkNode } from "elkjs/lib/elk.bundled.js";

const elk = new ELK();

/** Decision order (ADR-0059): the split comes before cleaning, since cleaning measures train rows. */
export const STAGES: MethodologyStage[] = ["question", "data", "split", "cleaning", "features", "models", "evaluation", "reporting"];

const DECISION = { width: 260, height: 64 };
const ROUTE = { width: 230, height: 72 };
/** Room inside a stage box for its heading. */
const STAGE_HEAD = 48;
const STAGE_PAD = 16;

export type DecisionTreeNode =
  | Node<{ stage: MethodologyStage; count: number }, "stage">
  | Node<{ rule: MethodologyRule; review: MethodologyReviewItem | undefined }, "decision">
  | Node<{ route: MethodologyRule["alternatives"][number]; picked: boolean; dimmed: boolean }, "route">;

export type DecisionTree = { nodes: DecisionTreeNode[]; edges: Edge[] };

/** The methodology as a decision tree (ADR-0059): each decision branches into its routes, and
 * every route leads on to the next decision, in decision order. A route shows its condition.
 * With a flow's review, the route it recommends is lit and its siblings dimmed.
 * Positions come from `layoutDecisionTree`. View state only. */
export function decisionTree(rules: MethodologyRule[], reviews: Map<string, MethodologyReviewItem>, { drafts }: { drafts: boolean }): DecisionTree {
  const shown = STAGES.flatMap((stage) => rules.filter((r) => r.stage === stage && (drafts || r.status === "active")));
  const nodes: DecisionTreeNode[] = [];
  const edges: Edge[] = [];
  for (const stage of STAGES) {
    const count = shown.filter((r) => r.stage === stage).length;
    if (count > 0) nodes.push({ id: `stage:${stage}`, type: "stage", position: { x: 0, y: 0 }, data: { stage, count } });
  }
  shown.forEach((rule, at) => {
    const parentId = `stage:${rule.stage}`;
    const review = reviews.get(rule.id);
    nodes.push({ id: rule.id, type: "decision", parentId, position: { x: 0, y: 0 }, ...DECISION, data: { rule, review } });
    const next = shown[at + 1];
    for (const route of rule.alternatives) {
      const id = `${rule.id}#${route.id}`;
      const picked = review?.recommended_alternative_id === route.id;
      const dimmed = review?.recommended_alternative_id !== undefined && !picked;
      nodes.push({ id, type: "route", parentId, position: { x: 0, y: 0 }, ...ROUTE, data: { route, picked, dimmed } });
      edges.push({ id: `${rule.id}>${id}`, source: rule.id, target: id });
    }
    if (next) for (const route of rule.alternatives) edges.push({ id: `${rule.id}#${route.id}>${next.id}`, source: `${rule.id}#${route.id}`, target: next.id });
  });
  // Branches first, then the links on to the next decision, so the order reads like the tree.
  edges.sort((a, b) => shown.findIndex((r) => a.id.startsWith(r.id)) - shown.findIndex((r) => b.id.startsWith(r.id)) || Number(a.source.includes("#")) - Number(b.source.includes("#")));
  return { nodes, edges };
}

/** Places the tree with ELK's layered layout, left to right like the flow canvas: each
 * decision, then its routes stacked in one column, then the next decision. Stage boxes are
 * groups laid out in the same pass, so links between stages stay straight. Child positions are
 * relative to their stage box, as React Flow expects. */
export async function layoutDecisionTree(tree: DecisionTree): Promise<DecisionTree> {
  const stages = tree.nodes.filter((n) => n.type === "stage");
  const graph: ElkNode = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
      "elk.layered.spacing.nodeNodeBetweenLayers": "48",
      "elk.spacing.nodeNode": "14",
      "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
    },
    children: stages.map((stage) => ({
      id: stage.id,
      layoutOptions: { "elk.padding": `[top=${STAGE_HEAD},left=${STAGE_PAD},bottom=${STAGE_PAD},right=${STAGE_PAD}]` },
      children: tree.nodes.filter((n) => n.parentId === stage.id).map((n) => ({ id: n.id, width: n.width!, height: n.height! })),
    })),
    edges: tree.edges.map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
  };
  const laid = await elk.layout(graph);
  const placed = new Map<string, ElkNode>();
  for (const box of laid.children ?? []) {
    placed.set(box.id, box);
    for (const child of box.children ?? []) placed.set(child.id, child);
  }
  const nodes = tree.nodes.map((n) => {
    const at = placed.get(n.id)!;
    return { ...n, position: { x: at.x ?? 0, y: at.y ?? 0 }, width: at.width, height: at.height } as DecisionTreeNode;
  });
  return { nodes, edges: tree.edges };
}
