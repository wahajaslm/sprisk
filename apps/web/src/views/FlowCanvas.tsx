import "@xyflow/react/dist/style.css";

import type { Attempt, Operator, PipelineVersion } from "@sprisk/contracts";
import {
  Background,
  BackgroundVariant,
  BaseEdge,
  type Edge,
  type EdgeProps,
  getBezierPath,
  Handle,
  type Node,
  type NodeProps,
  Panel,
  Position,
  ReactFlow,
  useNodesState,
  useReactFlow,
  useViewport,
} from "@xyflow/react";
import { useEffect } from "react";

import { useOperators, usePipelineVersions, useRunAttempts } from "../api/hooks.ts";
import { latestByNode } from "../flow/latest.ts";
import { kindOf, type NodeKind, shortName, STAGES, type Stage, stageNumber, stageOf } from "../flow/stages.ts";
import { useSelection } from "../workbench/selection.ts";
import { KindIcon, KindMark } from "./Icons.tsx";

const COLUMN = 236;
const NODE_W = 184;
const NODE_H = 52;
const ROW = 64;
const HEAD = 36;
const PAD = 12;
/** Studio's stage greys, darker to lighter left to right. */
const STAGE_HUE = ["#4a4a4a", "#636363", "#7e7e7e", "#9c9c9c", "#bfbfbf", "#e8e8e8"] as const;

type StepData = { id: string; operator: string; kind: NodeKind; state: string; selected: boolean };
type FrameData = { stage: Stage; count: number; active: boolean };
type FlowEdgeData = { hue: string };

const STATUS: Record<string, { text: string; tone: string }> = {
  succeeded: { text: "succeeded", tone: "done" },
  running: { text: "Running…", tone: "live" },
  leased: { text: "Starting…", tone: "live" },
  queued: { text: "Queued", tone: "idle" },
  failed: { text: "failed", tone: "bad" },
  timed_out: { text: "timed out", tone: "bad" },
};
const statusOf = (state: string) => STATUS[state] ?? { text: state, tone: "idle" };

function StepNode({ data }: NodeProps<Node<StepData>>) {
  const select = useSelection((s) => s.selectNode);
  const status = statusOf(data.state);
  return (
    <button
      type="button"
      className={`flow-node${data.selected ? " selected" : ""}`}
      title={data.operator}
      onClick={() => select(data.id)}
    >
      <Handle id="in" type="target" position={Position.Left} isConnectable={false} />
      <Handle id="in-top" type="target" position={Position.Top} isConnectable={false} />
      <span className={`icon-tile kind-${data.kind}${data.selected ? " ring" : ""}`}>
        <KindIcon kind={data.kind} />
      </span>
      <span className="node-text">
        <span className="node-title">{data.id}</span>
        <span className={`node-status tone-${status.tone}`}>
          <span className="dot" aria-hidden="true" />
          {status.text}
        </span>
      </span>
      <Handle id="out" type="source" position={Position.Right} isConnectable={false} />
      <Handle id="out-bottom" type="source" position={Position.Bottom} isConnectable={false} />
    </button>
  );
}

function StageFrame({ data }: NodeProps<Node<FrameData>>) {
  return (
    <div className={`stage-frame${data.active ? " active" : ""}`}>
      <div className="stage-frame-head">
        <span className="stage-num">{stageNumber(data.stage)}</span>
        <span className="stage-label">{data.stage}</span>
        <span className="spacer" />
        <span className="stage-count">
          {data.count} {data.count === 1 ? "step" : "steps"}
        </span>
      </div>
    </div>
  );
}

function FlowEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data }: EdgeProps<Edge<FlowEdgeData>>) {
  const [path] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const hue = data?.hue ?? STAGE_HUE[5];
  return (
    <>
      <BaseEdge id={id} path={path} style={{ stroke: hue, strokeWidth: 1.1 }} />
      <circle cx={targetX} cy={targetY} r={2.2} fill={hue} />
    </>
  );
}

const nodeTypes = { step: StepNode, frame: StageFrame };
const edgeTypes = { flow: FlowEdge };

/** Stage columns left to right, steps stacked inside their stage (Studio layout). */
export function layout(
  pipeline: PipelineVersion,
  operators: Map<string, Operator>,
  latest: Map<string, Attempt>,
  selectedId: string | undefined,
): { nodes: Node[]; edges: Edge[] } {
  const byStage = new Map<Stage, string[]>();
  const stageOfNode = new Map<string, Stage>();
  for (const n of pipeline.nodes) {
    const op = operators.get(n.operator);
    const stage = op ? stageOf(op) : "Unknown";
    stageOfNode.set(n.id, stage);
    byStage.set(stage, [...(byStage.get(stage) ?? []), n.id]);
  }
  const used = STAGES.filter((s) => byStage.has(s));
  const nodes: Node[] = [];
  used.forEach((stage, col) => {
    const ids = byStage.get(stage) ?? [];
    const height = HEAD + PAD + ids.length * ROW;
    nodes.push({
      id: `stage:${stage}`,
      type: "frame",
      position: { x: col * COLUMN, y: 0 },
      width: NODE_W + 2 * PAD,
      height,
      data: { stage, count: ids.length, active: selectedId !== undefined && ids.includes(selectedId) },
      draggable: false,
      selectable: false,
      zIndex: -1,
    });
    ids.forEach((id, row) => {
      const node = pipeline.nodes.find((n) => n.id === id);
      const op = node ? operators.get(node.operator) : undefined;
      nodes.push({
        id,
        type: "step",
        position: { x: col * COLUMN + PAD, y: HEAD + PAD + row * ROW },
        width: NODE_W,
        height: NODE_H,
        data: {
          id,
          operator: node ? shortName(node.operator) : id,
          kind: op ? kindOf(op) : "recipe",
          state: latest.get(id)?.state ?? "not run",
          selected: id === selectedId,
        },
      });
    });
  });
  const edges: Edge[] = pipeline.edges.map((e) => {
    const source = e.from.split(".")[0] ?? e.from;
    const target = e.to.split(".")[0] ?? e.to;
    const stage = stageOfNode.get(target) ?? "Unknown";
    // Within one stage the steps are stacked, so the edge runs down instead of looping round.
    const sameStage = stageOfNode.get(source) === stage;
    return {
      id: `${e.from}->${e.to}`,
      type: "flow",
      source,
      target,
      sourceHandle: sameStage ? "out-bottom" : "out",
      targetHandle: sameStage ? "in-top" : "in",
      data: { hue: STAGE_HUE[STAGES.indexOf(stage)] ?? STAGE_HUE[5] },
    };
  });
  return { nodes, edges };
}

export function FlowCanvas() {
  const { pipelineVersionId, runId, nodeId } = useSelection();
  const versions = usePipelineVersions();
  const operators = useOperators();
  const attempts = useRunAttempts(pipelineVersionId, runId);

  if (versions.isError) return <p role="alert" className="error pad">{versions.error.message}</p>;
  if (operators.isError) return <p role="alert" className="error pad">{operators.error.message}</p>;
  if (versions.isPending || operators.isPending) return <p className="muted pad">Loading flow…</p>;
  const pipeline = versions.data.find((v) => v.id === pipelineVersionId);
  if (!pipeline) return <p className="muted pad">No flow yet. Submit one with <code>sprisk run</code>.</p>;

  const byRef = new Map(operators.data.map((op) => [op.id, op]));
  const computed = layout(pipeline, byRef, latestByNode(attempts.data ?? []), nodeId);
  return (
    <div className="flow" aria-label="Flow canvas">
      {attempts.isError && <p role="alert" className="error pad">{attempts.error.message}</p>}
      <Canvas computed={computed} />
    </div>
  );
}

/** Nodes can be dragged and the canvas panned. A dragged node keeps its place while its
 * status keeps updating. Positions are view state only; they are not saved (rule 9). */
function Canvas({ computed }: { computed: { nodes: Node[]; edges: Edge[] } }) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(computed.nodes);
  const key = JSON.stringify(computed.nodes.map((n) => [n.id, n.data]));
  useEffect(() => {
    setNodes((shown) => {
      const moved = new Map(shown.map((n) => [n.id, n.position]));
      return computed.nodes.map((n) => ({ ...n, position: moved.get(n.id) ?? n.position }));
    });
    // `key` captures every change to the computed nodes; positions are kept from `shown`.
  }, [key]);
  return (
    <ReactFlow
      nodes={nodes}
      edges={computed.edges}
      onNodesChange={onNodesChange}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      fitView
      fitViewOptions={{ padding: 0.25 }}
      nodesConnectable={false}
      minZoom={0.3}
      maxZoom={2}
      proOptions={{ hideAttribution: true }}
      colorMode="dark"
    >
      <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="rgba(255,255,255,0.07)" />
      <Panel position="bottom-left">
        <ZoomControl />
      </Panel>
      <Panel position="bottom-right">
        <Legend />
      </Panel>
    </ReactFlow>
  );
}

function ZoomControl() {
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  const { zoom } = useViewport();
  return (
    <div className="zoom" role="group" aria-label="Zoom">
      <button type="button" aria-label="Zoom out" onClick={() => void zoomOut()}>
        −
      </button>
      <span className="zoom-label">{Math.round(zoom * 100)}%</span>
      <button type="button" aria-label="Zoom in" onClick={() => void zoomIn()}>
        +
      </button>
      <button type="button" className="fit" onClick={() => void fitView({ padding: 0.25 })}>
        Fit
      </button>
    </div>
  );
}

const LEGEND: [NodeKind, string][] = [
  ["source", "Data"],
  ["recipe", "Step"],
  ["decision", "Decision"],
  ["model", "Model"],
];

function Legend() {
  return (
    <div className="legend">
      {LEGEND.map(([kind, label]) => (
        <span key={kind}>
          <KindMark kind={kind} />
          {label}
        </span>
      ))}
    </div>
  );
}
