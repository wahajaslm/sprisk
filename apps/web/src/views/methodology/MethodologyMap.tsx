import "@xyflow/react/dist/style.css";

import { Background, BackgroundVariant, Handle, type NodeProps, Position, ReactFlow } from "@xyflow/react";
import type { MethodologyReviewItem, MethodologyRule } from "@sprisk/contracts";
import { useMemo } from "react";

import { ruleTree, stageName, type TreeNode } from "./ruleTree.ts";

type Props = {
  rules: MethodologyRule[];
  reviews: Map<string, MethodologyReviewItem>;
  picked: string | undefined;
  onPick: (ruleId: string) => void;
};

/** The methodology map (ADR-0059): each stage in decision order, its decisions, and each
 * decision's routes with the condition that leads to them. With a flow selected, each
 * decision shows its status on that flow. */
export function MethodologyMap({ rules, reviews, picked, onPick }: Props) {
  const tree = useMemo(() => ruleTree(rules, reviews), [rules, reviews]);
  const nodes = tree.nodes.map((n) => (n.type === "decision" ? { ...n, selected: n.id === picked } : n));
  const edges = tree.edges.map((e) => ({ ...e, type: "smoothstep", className: "mth-edge trunk" }));
  return (
    <div className="mth-map" role="region" aria-label="Methodology map">
      <ReactFlow
        key={rules.length}
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        onNodeClick={(_event, node) => node.type === "decision" && onPick(node.id)}
        // Readable size from the left: the whole map fitted to the window would be too small to read.
        defaultViewport={{ x: 24, y: 64, zoom: 0.85 }}
        panOnScroll
        nodesDraggable={false}
        nodesConnectable={false}
        minZoom={0.25}
        maxZoom={1.5}
        proOptions={{ hideAttribution: true }}
        colorMode="dark"
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="rgba(255,255,255,0.12)" />
      </ReactFlow>
    </div>
  );
}

function StageBox({ data }: NodeProps<Extract<TreeNode, { type: "stage" }>>) {
  return (
    <div className="mth-stage-box">
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <header className="mth-stage-head">
        <span className="mth-stage-ring">{data.number}</span>
        <h2>{stageName(data.stage)}</h2>
        <span className="muted">{data.count === 1 ? "1 decision" : `${data.count} decisions`}</span>
      </header>
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  );
}

/** Plain names for review statuses, as people read them. */
export const STATUS_LABEL: Record<MethodologyReviewItem["status"], string> = {
  settled: "Settled",
  proposal: "Proposal",
  needs_fact: "Needs a fact",
  needs_run: "Needs a run",
  waiting: "Waiting",
  no_subject: "No step yet",
  not_applicable: "Not applicable",
};

function DecisionCard({ data, selected }: NodeProps<Extract<TreeNode, { type: "decision" }>>) {
  const { rule, review } = data;
  return (
    <button type="button" className="mth-decision" aria-pressed={selected} aria-label={rule.name}>
      <span className="mth-decision-head">
        <span className="mth-decision-name">{rule.name}</span>
        <span className="mth-decision-meta">
          <code>{rule.decides}</code>
          {rule.status === "draft" && <span className="mth-chip draft">Draft</span>}
          {review && (
            <span className={`mth-chip ${review.status}`} title={review.reason}>
              {STATUS_LABEL[review.status]}
            </span>
          )}
        </span>
      </span>
      <ol className="mth-routes">
        {rule.alternatives.map((a) => (
          <li key={a.id} className={a.id === review?.recommended_alternative_id ? "picked" : undefined} title={`${a.description}\nWhy: ${a.rationale}`}>
            <span className="mth-route-name">{a.label}</span>
            <span className="mth-route-when">{a.condition ? `When ${a.condition}` : a.description}</span>
          </li>
        ))}
      </ol>
    </button>
  );
}

const NODE_TYPES = { stage: StageBox, decision: DecisionCard };
