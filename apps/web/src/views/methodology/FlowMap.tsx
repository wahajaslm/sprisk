import "@xyflow/react/dist/style.css";

import { Background, BackgroundVariant, BaseEdge, type Edge, EdgeLabelRenderer, type EdgeProps, getBezierPath, Handle, type NodeProps, Position, ReactFlow } from "@xyflow/react";
import type { MethodologyReviewItem, MethodologyRule } from "@sprisk/contracts";
import { useMemo } from "react";

import { type FlowEdgeData, flowGraph, type FlowNode } from "./flowGraph.ts";
import { STATUS_LABEL } from "./MethodologyMap.tsx";

type Props = {
  rules: MethodologyRule[];
  reviews: Map<string, MethodologyReviewItem>;
  path: boolean;
  /** A rule's id, or a route's (`<rule id>#<route id>`). */
  picked: string | undefined;
  onPick: (nodeId: string) => void;
};

/** The methodology as a flow diagram: circles are steps, diamonds are the decisions on the
 * connections between them, and each curved branch says why it is taken. */
export function FlowMap({ rules, reviews, path, picked, onPick }: Props) {
  const graph = useMemo(() => flowGraph(rules, reviews, { path }), [rules, reviews, path]);
  const nodes = graph.nodes.map((n) => (n.type === "decision" || n.type === "step" ? { ...n, selected: n.id === picked } : n));
  const edges = graph.edges.map((e) => ({ ...e, selected: e.data?.pick !== undefined && e.data.pick === picked, data: { ...e.data!, onPick } }));
  return (
    <div className="mth-map mth-flow" role="region" aria-label="Methodology flow">
      <ReactFlow
        key={`${graph.nodes.length}`}
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        onNodeClick={(_event, node) => {
          if (node.type === "decision" || node.type === "step") onPick(node.id);
        }}
        fitView
        fitViewOptions={{ nodes: graph.nodes.filter((n) => n.position.x < START_WIDTH).map((n) => ({ id: n.id })), maxZoom: 1, padding: 0.1 }}
        panOnScroll
        nodesDraggable={false}
        nodesConnectable={false}
        minZoom={0.15}
        maxZoom={1.5}
        proOptions={{ hideAttribution: true }}
        colorMode="dark"
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="rgba(255,255,255,0.12)" />
      </ReactFlow>
    </div>
  );
}

const LABEL = { because: "Because", when: "When", why: "Why" } as const;

/** A curved connection; a branch out of a decision carries its reason, which picks its route. */
function ReasonEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, selected }: EdgeProps<Edge<FlowEdgeData & { onPick: (id: string) => void }>>) {
  const [line, labelX, labelY] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, curvature: 0.45 });
  const reason = data?.reason;
  const className = `mth-flow-edge ${data?.kind ?? "trunk"}${data?.onPath ? " path" : ""}${selected ? " selected" : ""}`;
  return (
    <>
      <BaseEdge id={id} path={line} className={className} />
      {reason && (
        <EdgeLabelRenderer>
          <button
            type="button"
            className={`mth-flow-reason nodrag nopan ${reason.kind}${data?.onPath ? " path" : ""}`}
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
            title={`${LABEL[reason.kind]}: ${reason.text}`}
            aria-pressed={selected}
            disabled={!data?.pick}
            onClick={() => data?.pick && data.onPick(data.pick)}
          >
            <span className="mth-flow-reason-kind">{LABEL[reason.kind]}</span> {reason.text}
          </button>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

function Ports() {
  return (
    <>
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </>
  );
}

function TerminalNode({ data }: NodeProps<Extract<FlowNode, { type: "terminal" }>>) {
  return (
    <div className={`mth-flow-node terminal${data.dimmed ? " dimmed" : ""}`}>
      <span className="mth-flow-circle" />
      <span className="mth-flow-label">{data.label}</span>
      <Ports />
    </div>
  );
}

function ForkNode({ data }: NodeProps<Extract<FlowNode, { type: "fork" }>>) {
  return (
    <div className={`mth-flow-node fork${data.dimmed ? " dimmed" : ""}`}>
      <span className="mth-flow-diamond" />
      <span className="mth-flow-label">{data.question}</span>
      <Ports />
    </div>
  );
}

function BandNode({ data }: NodeProps<Extract<FlowNode, { type: "band" }>>) {
  return (
    <div className={`mth-flow-band${data.dimmed ? " dimmed" : ""}`}>
      <span className="mth-node-code">{data.code}</span> <h2>{data.title}</h2>
    </div>
  );
}

function DecisionNode({ data, selected }: NodeProps<Extract<FlowNode, { type: "decision" }>>) {
  const { rule, review } = data;
  return (
    // nopan: a click on a decision picks it; it never starts a pan of the map.
    <button type="button" className={`mth-flow-node decision nopan ${review?.status ?? ""}${rule.status === "draft" ? " draft" : ""}${data.dimmed ? " dimmed" : ""}`} aria-pressed={selected} aria-label={rule.name} title={rule.decides}>
      <span className="mth-flow-diamond" />
      <span className="mth-flow-label">
        <span className="mth-node-code">{data.code}</span> {rule.name}
        {review && <span className={`mth-flow-status ${review.status}`}>{STATUS_LABEL[review.status]}</span>}
      </span>
      <Ports />
    </button>
  );
}

function StepNode({ data, selected }: NodeProps<Extract<FlowNode, { type: "step" }>>) {
  const { route, code, picked, dimmed } = data;
  return (
    <button type="button" className={`mth-flow-node step nopan${picked ? " picked" : ""}${dimmed ? " dimmed" : ""}`} aria-pressed={selected} aria-label={route.label} title={route.description}>
      <span className="mth-flow-circle" />
      <span className="mth-flow-label">
        <span className="mth-node-code">{code}</span> {route.label}
      </span>
      <Ports />
    </button>
  );
}

/** How much of the diagram, from the left, the canvas fits on opening. */
const START_WIDTH = 1300;

const NODE_TYPES = { terminal: TerminalNode, fork: ForkNode, band: BandNode, decision: DecisionNode, step: StepNode };
const EDGE_TYPES = { reason: ReasonEdge };
