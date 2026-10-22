import "@xyflow/react/dist/style.css";

import { Background, BackgroundVariant, Handle, type NodeProps, Position, ReactFlow } from "@xyflow/react";
import type { MethodologyReviewItem } from "@sprisk/contracts";
import { useMemo } from "react";

import { type Chapter, type FlowNode, SIZE, stageFlow } from "./flowGraph.ts";
import { STATUS_LABEL } from "./MethodologyMap.tsx";

type Props = {
  chapter: Chapter;
  reviews: Map<string, MethodologyReviewItem>;
  path: boolean;
  from: string;
  to: string;
  /** A rule's id, or a route's (`<rule id>#<route id>`). */
  picked: string | undefined;
  onPick: (nodeId: string) => void;
};

/** One stage of the methodology as a flow diagram, read top to bottom: circles are steps,
 * diamonds the decisions between them, and each route's circle says why it is taken. */
export function FlowMap({ chapter, reviews, path, from, to, picked, onPick }: Props) {
  const flow = useMemo(() => stageFlow(chapter, reviews, { path, from, to }), [chapter, reviews, path, from, to]);
  const nodes = flow.nodes.map((n) => (n.type === "decision" || n.type === "step" ? { ...n, selected: n.id === picked } : n));
  return (
    <div className="mth-map mth-flow" role="region" aria-label="Methodology flow">
      <ReactFlow
        key={chapter.key}
        nodes={nodes}
        edges={flow.edges}
        nodeTypes={NODE_TYPES}
        onNodeClick={(_event, node) => {
          if (node.type === "decision" || node.type === "step") onPick(node.id);
        }}
        // Open on the top of the stage at full size; the rest is a scroll down.
        fitView
        fitViewOptions={{ nodes: flow.nodes.filter((n) => n.position.y < START_HEIGHT).map((n) => ({ id: n.id })), maxZoom: 1, padding: 0.12 }}
        panOnScroll
        nodesDraggable={false}
        nodesConnectable={false}
        minZoom={0.3}
        maxZoom={1.5}
        proOptions={{ hideAttribution: true }}
        colorMode="dark"
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="rgba(255,255,255,0.08)" />
      </ReactFlow>
    </div>
  );
}

/** Lines come in at the top and leave at the bottom. */
function Ports() {
  return (
    <>
      <Handle type="target" position={Position.Top} isConnectable={false} />
      <Handle type="source" position={Position.Bottom} isConnectable={false} />
    </>
  );
}

function TerminalNode({ data }: NodeProps<Extract<FlowNode, { type: "terminal" }>>) {
  return (
    <div className={`mth-flow-node terminal${data.dimmed ? " dimmed" : ""}`}>
      <span className="mth-flow-circle" />
      <span className="mth-flow-side">{data.label}</span>
      <Ports />
    </div>
  );
}

function DecisionNode({ data, selected }: NodeProps<Extract<FlowNode, { type: "decision" }>>) {
  const { rule, review } = data;
  return (
    // nopan: a click on a decision picks it; it never starts a pan of the map.
    <button type="button" className={`mth-flow-node decision nopan ${review?.status ?? ""}${rule.status === "draft" ? " draft" : ""}${data.dimmed ? " dimmed" : ""}`} aria-pressed={selected} aria-label={rule.name} title={rule.decides}>
      <span className="mth-flow-diamond" />
      <span className="mth-flow-side">
        <span className="mth-flow-name">
          <span className="mth-node-code">{data.code}</span> {rule.name}
        </span>
        <span className="mth-flow-meta">
          {rule.decides}
          {rule.status === "draft" && " · draft"}
          {review && <span className={`mth-flow-status ${review.status}`}> · {STATUS_LABEL[review.status]}</span>}
        </span>
      </span>
      <Ports />
    </button>
  );
}

const REASON = { because: "Because", when: "When", why: "Why" } as const;

function StepNode({ data, selected }: NodeProps<Extract<FlowNode, { type: "step" }>>) {
  const { route, reason, code, picked, dimmed } = data;
  return (
    <button type="button" className={`mth-flow-node step nopan${picked ? " picked" : ""}${dimmed ? " dimmed" : ""}`} aria-pressed={selected} aria-label={route.label} title={`${route.label}\n${REASON[reason.kind]}: ${reason.text}`}>
      <Handle type="target" position={Position.Top} isConnectable={false} />
      <span className="mth-flow-circle" style={{ width: SIZE.step.circle, height: SIZE.step.circle }} />
      <span className="mth-flow-name">
        <span className="mth-node-code">{code}</span> {route.label}
      </span>
      <span className={`mth-flow-reason ${reason.kind}`}>
        <span className="mth-flow-reason-kind">{REASON[reason.kind]}</span> {reason.text}
      </span>
      <Handle type="source" position={Position.Bottom} isConnectable={false} />
    </button>
  );
}

/** How much of the stage, from the top, the canvas fits on opening. */
const START_HEIGHT = 700;

const NODE_TYPES = { terminal: TerminalNode, decision: DecisionNode, step: StepNode };
