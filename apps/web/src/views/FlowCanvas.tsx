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
import { type RunChecks, useRunChecks } from "../api/checks.ts";
import { GATE_NODE, hasOutputs, latestByNode } from "../flow/latest.ts";
import { DETAIL_LEVELS, type DetailLevel, NODE_SIZE, useCanvasDetail } from "../workbench/detail.ts";
import { NodeVisual } from "./NodeVisual.tsx";
import { kindOf, type NodeKind, shortName, STAGES, type Stage, stageNumber, stageOf } from "../flow/stages.ts";
import { NodeFact } from "./NodeFact.tsx";
import { useSelection } from "../workbench/selection.ts";
import { KindIcon, KindMark } from "./Icons.tsx";

const COLUMN_GAP = 52;
const ROW_GAP = 12;
const HEAD = 36;
const PAD = 12;
/** Studio's stage greys, darker to lighter left to right. */
const STAGE_HUE = ["#4a4a4a", "#636363", "#7e7e7e", "#9c9c9c", "#bfbfbf", "#e8e8e8"] as const;

type StepData = {
  id: string;
  operator: string;
  operatorRef: string;
  capability: string;
  params: Record<string, unknown>;
  pipelineVersionId: string;
  isEvaluator: boolean;
  kind: NodeKind;
  state: string;
  attemptId?: string;
  /** Methodology checks citing this step that did not pass. */
  concerns: number;
  level: DetailLevel;
  selected: boolean;
};
type FrameData = { stage: Stage; count: number; active: boolean };
type FlowEdgeData = { hue: string };

const STATUS: Record<string, { text: string; tone: string }> = {
  succeeded: { text: "succeeded", tone: "done" },
  cache_hit: { text: "cached", tone: "done" },
  running: { text: "Running…", tone: "live" },
  leased: { text: "Starting…", tone: "live" },
  queued: { text: "Queued", tone: "idle" },
  failed: { text: "failed", tone: "bad" },
  timed_out: { text: "timed out", tone: "bad" },
};
const statusOf = (state: string) => STATUS[state] ?? { text: state, tone: "idle" };

function StepNode(props: NodeProps<Node<StepData>>) {
  return props.data.level === "compact" ? <CompactNode {...props} /> : <CardNode {...props} />;
}

function CardNode({ data }: NodeProps<Node<StepData>>) {
  const select = useSelection((s) => s.selectNode);
  const status = statusOf(data.state);
  const { width, height } = NODE_SIZE[data.level];
  return (
    <button
      type="button"
      className={`flow-card${data.selected ? " selected" : ""}${status.tone === "bad" ? " bad" : ""}`}
      style={{ width, height }}
      title={data.operatorRef}
      onClick={() => select(data.id)}
    >
      <Handle id="in" type="target" position={Position.Left} isConnectable={false} />
      <Handle id="in-top" type="target" position={Position.Top} isConnectable={false} />
      <span className="card-head">
        <span className={`icon-tile small kind-${data.kind}${data.selected ? " ring" : ""}`}>
          <KindIcon kind={data.kind} size={13} />
        </span>
        <span className="card-title">{data.id}</span>
        <span className="card-op">{data.operator}</span>
      </span>
      <span className="card-body">
        {/* In Detail, an evaluator's metric is drawn large below; do not repeat it. */}
        {!(data.level === "detail" && data.isEvaluator) && (
        <span className="card-fact">
          {data.attemptId ? (
            <NodeFact attemptId={data.attemptId} operator={data.operatorRef} isEvaluator={data.isEvaluator} status="output saved" />
          ) : (
            <span className="muted">no output yet</span>
          )}
        </span>
        )}
        {data.level === "detail" && data.attemptId && (
          <NodeVisual
            attemptId={data.attemptId}
            operator={data.operatorRef}
            capability={data.capability}
            params={data.params}
            pipelineVersionId={data.pipelineVersionId}
            nodeId={data.id}
          />
        )}
      </span>
      <span className={`card-status tone-${status.tone}`}>
        <span className="dot" aria-hidden="true" />
        {status.text}
        {data.concerns > 0 && (
          <span className="card-concern">⚠ {data.concerns === 1 ? "1 check" : `${data.concerns} checks`}</span>
        )}
      </span>
      <Handle id="out" type="source" position={Position.Right} isConnectable={false} />
      <Handle id="out-bottom" type="source" position={Position.Bottom} isConnectable={false} />
    </button>
  );
}

/** Compact: the step's name only. Its state shows as the outline; details are in the Inspector. */
function CompactNode({ data }: NodeProps<Node<StepData>>) {
  const select = useSelection((s) => s.selectNode);
  const status = statusOf(data.state);
  return (
    <button
      type="button"
      className={`flow-node${data.selected ? " selected" : ""}${status.tone === "bad" || data.concerns > 0 ? " bad" : ""}`}
      title={`${data.operator} · ${status.text}`}
      onClick={() => select(data.id)}
    >
      <Handle id="in" type="target" position={Position.Left} isConnectable={false} />
      <Handle id="in-top" type="target" position={Position.Top} isConnectable={false} />
      <span className="node-title">{data.id}</span>
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
  level: DetailLevel = "compact",
  concerns: Map<string, number> = new Map(),
): { nodes: Node[]; edges: Edge[] } {
  const { width: NODE_W, height: NODE_H } = NODE_SIZE[level];
  const COLUMN = NODE_W + COLUMN_GAP;
  const ROW = NODE_H + ROW_GAP;
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
          operatorRef: node?.operator ?? "",
          capability: op?.capability_class ?? "",
          params: node?.params ?? {},
          pipelineVersionId: pipeline.id,
          isEvaluator: op?.capability_class === "evaluator",
          concerns: concerns.get(id) ?? 0,
          level,
          kind: op ? kindOf(op) : "recipe",
          state: latest.get(id)?.state ?? "not run",
          ...(hasOutputs(latest.get(id)) ? { attemptId: latest.get(id)?.id } : {}),
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
  const level = useCanvasDetail((s) => s.level);
  const checks = useRunChecks(latestByNode(attempts.data ?? []).get(GATE_NODE));

  if (versions.isError) return <p role="alert" className="error pad">{versions.error.message}</p>;
  if (operators.isError) return <p role="alert" className="error pad">{operators.error.message}</p>;
  if (versions.isPending || operators.isPending) return <p className="muted pad">Loading flow…</p>;
  const pipeline = versions.data.find((v) => v.id === pipelineVersionId);
  if (!pipeline) return <p className="muted pad">No flow yet. Submit one with <code>sprisk run</code>.</p>;

  const byRef = new Map(operators.data.map((op) => [op.id, op]));
  const latest = latestByNode(attempts.data ?? []);
  const computed = layout(pipeline, byRef, latest, nodeId, level, concernsByNode(checks));
  return (
    <div className="flow" aria-label="Flow canvas">
      {attempts.isError && <p role="alert" className="error pad">{attempts.error.message}</p>}
      {/* A new level means new node sizes: lay the canvas out afresh. */}
      <Canvas key={level} computed={computed} />
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
      <Panel position="bottom-left" className="canvas-controls">
        <ZoomControl />
        <DetailSwitch />
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

const DETAIL_LABEL: Record<DetailLevel, string> = { compact: "Compact", detail: "Detail" };

/** How much each node shows. Kept per browser; it never changes the flow. */
function DetailSwitch() {
  const { level, setLevel } = useCanvasDetail();
  return (
    <div className="detail-switch" role="radiogroup" aria-label="Node detail">
      {DETAIL_LEVELS.map((l) => (
        <button key={l} type="button" role="radio" aria-checked={level === l} onClick={() => setLevel(l)}>
          {DETAIL_LABEL[l]}
        </button>
      ))}
    </div>
  );
}

function concernsByNode(run: RunChecks): Map<string, number> {
  const counts = new Map<string, number>();
  if (run.status !== "ready") return counts;
  for (const check of run.checks) {
    if (check.verdict === "pass") continue;
    for (const node of check.cited_nodes) counts.set(node, (counts.get(node) ?? 0) + 1);
  }
  return counts;
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
