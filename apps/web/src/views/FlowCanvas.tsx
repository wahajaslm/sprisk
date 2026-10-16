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
  useNodes,
  useNodesState,
  useReactFlow,
  useViewport,
} from "@xyflow/react";
import { useEffect, useRef, useState } from "react";
import { create } from "zustand";

import { useOperators, usePipelineVersions, useRunAttempts, useSaveAndRun } from "../api/hooks.ts";
import { type RunChecks, useRunChecks } from "../api/checks.ts";
import { GATE_NODE, hasOutputs, latestByNode } from "../flow/latest.ts";
import { DETAIL_LEVELS, type DetailLevel, NODE_SIZE, useCanvasDetail } from "../workbench/detail.ts";
import { NodeVisual } from "./NodeVisual.tsx";
import { addCodeStep } from "../flow/edit.ts";
import { flowPositions, GROUP_HEAD, type Group, type Point } from "../flow/layout.ts";
import { kindOf, type NodeKind, roleOf, shortName, stageGroups } from "../flow/stages.ts";
import type { InspectorTab } from "../workbench/inspectorTabs.ts";
import { useWorkbench } from "../workbench/workbench.ts";
import { NodeFact } from "./NodeFact.tsx";
import { useSelection } from "../workbench/selection.ts";
import { KindIcon, KindMark } from "./Icons.tsx";


type StepData = {
  id: string;
  operator: string;
  operatorRef: string;
  capability: string;
  params: Record<string, unknown>;
  pipelineVersionId: string;
  isEvaluator: boolean;
  kind: NodeKind;
  /** What the step is for, in plain words: "Transform". */
  role: string;
  state: string;
  attemptId?: string;
  /** Methodology checks citing this step that did not pass. */
  concerns: number;
  level: DetailLevel;
  selected: boolean;
};
type StageData = { name: string; count: number; active: boolean };

/** A stage's heading above its steps; no box around them (design reference). It sits above
 * the top-left of its steps and follows them when one is dragged. */
function StageHead({ id, data }: NodeProps<Node<StageData>>) {
  const steps = useNodes().filter((n) => n.parentId === id);
  const left = Math.min(...steps.map((n) => n.position.x));
  const top = Math.min(...steps.map((n) => n.position.y));
  const at = steps.length > 0 ? `translate(${left}px, ${top - GROUP_HEAD}px)` : undefined;
  return (
    <h3 className={`stage-head${data.active ? " active" : ""}`} style={at ? { transform: at } : undefined}>
      {data.name}
      <span className="stage-count">{data.count}</span>
    </h3>
  );
}

/** An edge into or out of the selected step is drawn brighter. */
type FlowEdgeData = { active: boolean };

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
      onContextMenu={(e) => {
        e.preventDefault();
        select(data.id);
        openStepMenu({ nodeId: data.id, x: e.clientX, y: e.clientY });
      }}
    >
      <Handle id="in" type="target" position={Position.Left} isConnectable={false} />
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
      <Handle id="top" type="target" position={Position.Top} isConnectable={false} />
      <Handle id="down" type="source" position={Position.Bottom} isConnectable={false} />
    </button>
  );
}

/** Width of the round icon in Compact (.round-icon). */
const ROUND_ICON = 44;

/** Compact: a round icon, the step's name and what it is for beside it; its state is a dot. */
function CompactNode({ data }: NodeProps<Node<StepData>>) {
  const select = useSelection((s) => s.selectNode);
  const status = statusOf(data.state);
  const bad = status.tone === "bad" || data.concerns > 0;
  return (
    <button
      type="button"
      className={`flow-round${data.selected ? " selected" : ""}${bad ? " bad" : ""}`}
      aria-label={`${data.id}, ${data.role}, ${status.text}`}
      title={data.operatorRef}
      onClick={() => select(data.id)}
      onContextMenu={(e) => {
        e.preventDefault();
        select(data.id);
        openStepMenu({ nodeId: data.id, x: e.clientX, y: e.clientY });
      }}
    >
      <Handle id="in" type="target" position={Position.Left} isConnectable={false} />
      <span className={`round-icon kind-${data.kind}`}>
        <KindIcon kind={data.kind} size={16} />
        <span className={`state-dot tone-${status.tone}`} role="img" aria-label={status.text} />
      </span>
      <span className="round-text">
        <span className="node-title">{data.id}</span>
        <span className="round-sub">{data.role}</span>
        {/* Only what needs attention gets words; a finished step is just its dot. */}
        {(status.tone === "bad" || status.tone === "live") && <span className={`round-state tone-${status.tone}`}>{status.text}</span>}
        {data.concerns > 0 && <span className="round-state tone-bad">⚠ {data.concerns === 1 ? "1 check" : `${data.concerns} checks`}</span>}
      </span>
      {/* The node is as wide as its label, so outgoing lines start right after the text. */}
      <Handle id="out" type="source" position={Position.Right} isConnectable={false} />
      {/* Within a stage, lines run down from icon to icon. */}
      <Handle id="top" type="target" position={Position.Top} isConnectable={false} style={{ left: ROUND_ICON / 2 }} />
      <Handle id="down" type="source" position={Position.Bottom} isConnectable={false} style={{ left: ROUND_ICON / 2 }} />
    </button>
  );
}

function FlowEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data }: EdgeProps<Edge<FlowEdgeData>>) {
  const [path] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  return <BaseEdge id={id} path={path} className={`flow-edge${data?.active ? " active" : ""}`} />;
}

const nodeTypes = { step: StepNode, stage: StageHead };
const edgeTypes = { flow: FlowEdge };

const LABEL_MAX = 128;

/** A compact node is the circle plus its label, no wider; Detail cards have one size. The label
 * width is estimated from its length (12.5px name, 11px role) and wraps past LABEL_MAX. */
function sizeOf(level: DetailLevel, id: string, role: string) {
  if (level !== "compact") return NODE_SIZE[level];
  const label = Math.min(LABEL_MAX, Math.ceil(Math.max(id.length * 7.2, role.length * 6.2)));
  return { width: 44 + 10 + label + 2, height: NODE_SIZE.compact.height };
}

/** React Flow nodes and edges for a flow, at the positions the layout chose. */
export function flowGraph(
  pipeline: PipelineVersion,
  operators: Map<string, Operator>,
  latest: Map<string, Attempt>,
  selectedId: string | undefined,
  level: DetailLevel,
  concerns: Map<string, number>,
  at: Map<string, Point>,
  groups: Group[] = [],
): { nodes: Node[]; edges: Edge[] } {
  const selectedGroup = selectedId ? stageGroups(pipeline, operators).get(selectedId) : undefined;
  const heads: Node[] = groups.map((g) => ({
    id: `stage:${g.id}`,
    type: "stage",
    position: { x: g.x, y: g.y },
    width: g.width,
    height: g.height,
    // The heading is the handle: dragging it moves every step of the group (React Flow sub-flow).
    draggable: true,
    dragHandle: ".stage-head",
    selectable: false,
    zIndex: -1,
    data: {
      name: g.id.split("#")[0] ?? g.id,
      count: g.count,
      active: g.id === selectedGroup,
    },
  }));
  const groupOf = stageGroups(pipeline, operators);
  const boxes = new Map(groups.map((g) => [g.id, g]));
  const steps: Node[] = pipeline.nodes.map((node) => {
    const id = node.id;
    const box = boxes.get(groupOf.get(id) ?? "");
    const point = at.get(id) ?? { x: 0, y: 0 };
    const op = operators.get(node.operator);
    const { width, height } = sizeOf(level, id, op ? roleOf(op) : "Step");
    return {
      id,
      type: "step",
      ...(box ? { parentId: `stage:${box.id}`, position: { x: point.x - box.x, y: point.y - box.y } } : { position: point }),
      width,
      height,
      data: {
        id,
        operator: shortName(node.operator),
        operatorRef: node.operator,
        capability: op?.capability_class ?? "",
        params: node.params,
        pipelineVersionId: pipeline.id,
        isEvaluator: op?.capability_class === "evaluator",
        concerns: concerns.get(id) ?? 0,
        level,
        kind: op ? kindOf(op) : "recipe",
        role: op ? roleOf(op) : "Step",
        state: latest.get(id)?.state ?? "not run",
        ...(hasOutputs(latest.get(id)) ? { attemptId: latest.get(id)?.id } : {}),
        selected: id === selectedId,
      },
    };
  });
  const nodes = [...heads, ...steps];
  const edges: Edge[] = pipeline.edges.map((e) => {
    const source = e.from.split(".")[0] ?? e.from;
    const target = e.to.split(".")[0] ?? e.to;
    const sameStage = groupOf.has(source) && groupOf.get(source) === groupOf.get(target);
    return {
      id: `${e.from}->${e.to}`,
      type: "flow",
      source,
      target,
      sourceHandle: sameStage ? "down" : "out",
      targetHandle: sameStage ? "top" : "in",
      data: { active: selectedId !== undefined && (source === selectedId || target === selectedId) },
    };
  });
  return { nodes, edges };
}

/** Layout runs off the main path (ELK is async); a new flow or node size lays out afresh. */
function usePositions(pipeline: PipelineVersion | undefined, level: DetailLevel, operators: Map<string, Operator>) {
  // Sizes depend on each step's role, so lay out again once the operators are known.
  const key = pipeline ? `${pipeline.id}/${level}/${operators.size}` : "";
  const [result, setResult] = useState<{ key: string; at?: Map<string, Point>; groups?: Group[]; error?: string }>();
  useEffect(() => {
    if (!pipeline) return;
    let live = true;
    const roleById = new Map(pipeline.nodes.map((n) => [n.id, operators.get(n.operator)]));
    const groups = stageGroups(pipeline, operators);
    flowPositions(
      pipeline,
      (id) => {
        const op = roleById.get(id);
        return sizeOf(level, id, op ? roleOf(op) : "Step");
      },
      (id) => groups.get(id),
    ).then(
      ({ nodes: at, groups }) => live && setResult({ key, at, groups }),
      (e: unknown) => live && setResult({ key, error: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      live = false;
    };
    // `key` names the pipeline version and size; versions are immutable.
  }, [key]);
  // Keep showing the last layout of this flow while the next one is computed: no flicker.
  return result?.key.startsWith(`${pipeline?.id ?? ""}/`) ? result : undefined;
}

export function FlowCanvas() {
  const { pipelineVersionId, runId, nodeId } = useSelection();
  const versions = usePipelineVersions();
  const operators = useOperators();
  const attempts = useRunAttempts(pipelineVersionId, runId);
  const level = useCanvasDetail((s) => s.level);
  const checks = useRunChecks(latestByNode(attempts.data ?? []).get(GATE_NODE));

  const pipelineNow = versions.data?.find((v) => v.id === pipelineVersionId);
  const positions = usePositions(pipelineNow, level, new Map((operators.data ?? []).map((op) => [op.id, op])));
  if (versions.isError) return <p role="alert" className="error pad">{versions.error.message}</p>;
  if (operators.isError) return <p role="alert" className="error pad">{operators.error.message}</p>;
  if (versions.isPending || operators.isPending) return <p className="muted pad">Loading flow…</p>;
  const pipeline = versions.data.find((v) => v.id === pipelineVersionId);
  if (!pipeline) return <p className="muted pad">No flow yet. Submit one with <code>sprisk run</code>.</p>;

  const byRef = new Map(operators.data.map((op) => [op.id, op]));
  const latest = latestByNode(attempts.data ?? []);
  if (positions?.error) return <p role="alert" className="error pad">Could not lay out the flow: {positions.error}</p>;
  if (!positions?.at) return <p className="muted pad">Laying out the flow…</p>;
  const computed = flowGraph(pipeline, byRef, latest, nodeId, level, concernsByNode(checks), positions.at, positions.groups);
  return (
    <div className="flow" aria-label="Flow canvas">
      {attempts.isError && <p role="alert" className="error pad">{attempts.error.message}</p>}
      {/* A new layout means new positions: start the canvas afresh. */}
      <Canvas key={positions.key} computed={computed} />
      <StepMenu pipeline={pipeline} operators={byRef} />
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
      <Background variant={BackgroundVariant.Dots} gap={20} size={1.4} color="rgba(255,255,255,0.18)" />
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

type MenuAt = { nodeId: string; x: number; y: number };

/** Which step's action menu is open, and where. UI state only. */
const useStepMenu = create<{ at: MenuAt | undefined; set: (at: MenuAt | undefined) => void }>((set) => ({
  at: undefined,
  set: (at) => set({ at }),
}));
const openStepMenu = (at: MenuAt) => useStepMenu.getState().set(at);

const OPEN_TABS: [InspectorTab, string][] = [
  ["data", "Open data"],
  ["code", "Open code"],
  ["parameters", "Open parameters"],
];

/** Right-click actions on a step. Escape or a click elsewhere closes it. */
function StepMenu({ pipeline, operators }: { pipeline: PipelineVersion; operators: Map<string, Operator> }) {
  const { at, set } = useStepMenu();
  const dock = useWorkbench((s) => s.dock);
  const { selectNode, showRun } = useSelection();
  const saveAndRun = useSaveAndRun();
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!at) return;
    first.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && set(undefined);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [at, set]);
  if (!at) return saveAndRun.isError ? <p role="alert" className="error canvas-error">{saveAndRun.error.message}</p> : null;
  const node = pipeline.nodes.find((n) => n.id === at.nodeId);
  const tablePort = node ? operators.get(node.operator)?.outputs.find((o) => o.kind === "table")?.name : undefined;
  const close = () => set(undefined);
  const act = (fn: () => void) => () => {
    fn();
    close();
  };
  return (
    <div className="menu-backdrop" onClick={close} onContextMenu={(e) => (e.preventDefault(), close())}>
      <div className="step-menu" role="menu" aria-label={at.nodeId} style={{ left: at.x, top: at.y }} onClick={(e) => e.stopPropagation()}>
        {OPEN_TABS.map(([tab, label], i) => (
          <button
            key={tab}
            ref={i === 0 ? first : undefined}
            type="button"
            role="menuitem"
            onClick={act(() => {
              selectNode(at.nodeId);
              dock?.showTab(tab);
            })}
          >
            {label}
          </button>
        ))}
        {tablePort && (
          <button
            type="button"
            role="menuitem"
            disabled={saveAndRun.isPending}
            onClick={act(() => {
              const { version, nodeId } = addCodeStep(pipeline, at.nodeId, String(tablePort));
              saveAndRun.mutate(version, { onSuccess: (r) => showRun(version.id, r.id, nodeId) });
            })}
          >
            Explore in code
          </button>
        )}
        <hr />
        <button type="button" role="menuitem" onClick={act(() => void navigator.clipboard.writeText(at.nodeId))}>
          Copy step id
        </button>
      </div>
    </div>
  );
}
