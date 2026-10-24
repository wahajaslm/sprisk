import "@xyflow/react/dist/style.css";

import type { Attempt, Operator, PipelineVersion } from "@sprisk/contracts";
import {
  applyNodeChanges,
  Background,
  BackgroundVariant,
  BaseEdge,
  type Edge,
  type EdgeProps,
  getBezierPath,
  Handle,
  type Node,
  type NodeChange,
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
import { createPortal } from "react-dom";
import { create } from "zustand";

import { useOperators, usePipelineVersions, useRunAttempts, useSaveAndRun, useStartRun } from "../api/hooks.ts";
import { checkCount, concernsByNode, useRunChecks } from "../api/checks.ts";
import { hasOutputs, latestByNode, statusOf } from "../flow/latest.ts";
import { DETAIL_LEVELS, type DetailLevel, NODE_SIZE, useCanvasDetail } from "../workbench/detail.ts";
import { NodeVisual } from "./NodeVisual.tsx";
import { CardFigure } from "./CardFigure.tsx";
import { addCodeStep, readersOf, removeStep } from "../flow/edit.ts";
import {
  flowPositions,
  GROUP_HEAD,
  type Group,
  keepDragged,
  MIN_STAGE_CARD_HEIGHT,
  MIN_STAGE_CARD_WIDTH,
  type Point,
  STAGE_FOOTER_HEIGHT,
  STAGE_HEAD_HEIGHT,
  STAGE_PAD_X,
} from "../flow/layout.ts";
import { figurePortOf, kindOf, type NodeKind, roleOf, shortName, STAGE_PURPOSE, STAGES, type Stage, stepLabel } from "../flow/stages.ts";
import type { InspectorTab } from "../workbench/inspectorTabs.ts";
import { useWorkbench } from "../workbench/workbench.ts";
import { NodeFact } from "./NodeFact.tsx";
import { useSelection } from "../workbench/selection.ts";
import { useNotebooks } from "../api/notebooks.ts";
import { KindIcon, NotebookIcon, PlayIcon, RedoIcon, RestartIcon, StopIcon, TrashIcon, UndoIcon } from "./Icons.tsx";
import { Loading } from "../components/ui/Loading.tsx";
import { useEscape } from "../hooks/useEscape.ts";
import { stageGroups } from "../notebook/stageNotebooks.ts";
import { stageDescription } from "./StageArtwork.tsx";
import { stepOf } from "../flow/ports.ts";


type StepData = {
  id: string;
  /** The kind of step, and what it is about (ADR-0055). */
  title: string;
  subject: string;
  operator: string;
  operatorRef: string;
  capability: string;
  params: Record<string, unknown>;
  pipelineVersionId: string;
  isEvaluator: boolean;
  /** An evaluator's metrics port: its headline metric is read from there. */
  metricsPort?: string;
  kind: NodeKind;
  /** What the step is for, in plain words: "Transform". */
  role: string;
  /** The step runs its own code in this flow, not the built-in (ADR-0028). */
  edited: boolean;
  state: string;
  attemptId?: string;
  /** The output port holding the step's figures, if it draws any. */
  figurePort?: string;
  /** Methodology checks citing this step that did not pass. */
  concerns: number;
  level: DetailLevel;
  selected: boolean;
};
type StageData = {
  name: string;
  count: number;
  completed?: number;
  running?: number;
  failed?: number;
  active: boolean;
  baseWidth?: number;
  baseHeight?: number;
};

/** A stage card containing its steps, styled as sleek dark cards with minimalist vector
 * artwork, header metadata, seamlessly aligned steps, and minimal icon controls. */
function StageHead({ data, selected }: NodeProps<Node<StageData>>) {
  const { pipelineVersionId, openStageNotebook } = useSelection();
  const startRun = useStartRun();

  const isLive = (data.running ?? 0) > 0;
  const handleRunAll = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (pipelineVersionId) {
      startRun.mutate(pipelineVersionId);
    }
  };

  const handleOpenNotebook = (e: React.MouseEvent) => {
    e.stopPropagation();
    openStageNotebook(data.name);
  };

  return (
    <div
      className={`stage-card${data.active || selected ? " active" : ""}${selected ? " selected" : ""}`}
      role="region"
      aria-label={`Stage ${data.name}`}
    >
      <div className="stage-card-header stage-head" title={`Stage: ${data.name} (${data.count} steps)`}>
        <div className="stage-title-row">
          <h3 className="stage-head stage-name">
            {data.name}
          </h3>
          <span className="stage-step-count">{data.count} {data.count === 1 ? "step" : "steps"}</span>
        </div>
        <p className="stage-purpose">{purposeOf(data.name)}</p>
      </div>
    </div>
  );
}

const purposeOf = (name: string) => (STAGES as readonly string[]).includes(name) ? STAGE_PURPOSE[name as Stage] : "";

/** An edge into or out of the selected step is drawn brighter; failed gate is dashed red. */
type FlowEdgeData = { active: boolean; failed?: boolean };

function StepNode(props: NodeProps<Node<StepData>>) {
  return props.data.level === "compact" ? <CompactNode {...props} /> : <CardNode {...props} />;
}

function CardNode({ data }: NodeProps<Node<StepData>>) {
  const select = useSelection((s) => s.selectNode);
  const { pipelineVersionId, runId } = useSelection();
  const versions = usePipelineVersions();
  const pipeline = versions.data?.find((v) => v.id === pipelineVersionId);
  const saveAndRun = useSaveAndRun(runId);
  const startRun = useStartRun();

  const status = statusOf(data.state);
  const isLive = status.tone === "live";
  const { width, height } = NODE_SIZE[data.level];

  const handleRunFromNode = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (pipelineVersionId) {
      startRun.mutate(pipelineVersionId);
    }
  };

  const showRun = useSelection((s) => s.showRun);
  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!pipeline) return;
    const readers = readersOf(pipeline, data.id);
    if (readers.length > 0) {
      alert(`Step "${data.id}" cannot be deleted because it is read by: ${readers.join(", ")}`);
      return;
    }
    const next = removeStep(pipeline, data.id);
    saveAndRun.mutate(next, {
      onSuccess: (r) => {
        select(undefined);
        showRun(next.id, r.id);
      },
    });
  };

  return (
    <button
      type="button"
      className={`flow-card${data.selected ? " selected" : ""}${status.tone === "bad" ? " bad" : ""}`}
      style={{ width, height }}
      aria-label={`${data.id}, ${data.title}, ${status.text}`}
      title={data.operatorRef}
      onClick={() => select(data.id)}
      onKeyDown={(e) => {
        if (e.key === "Delete" || e.key === "Backspace") handleDelete(e as any);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        select(data.id);
        openStepMenu({ nodeId: data.id, x: e.clientX, y: e.clientY });
      }}
    >
      <Handle id="in" type="target" position={Position.Left} isConnectable={false} />
      <span className="card-head">
        <span className="icon-tile small">
          <KindIcon kind={data.kind} size={13} />
        </span>
        <span className="card-title">{data.title}</span>
        <span className="card-op">
          {data.subject}
          {data.edited && " · edited"}
        </span>
        <span className={`node-hover-actions${isLive ? " has-live" : ""}`}>
          <span
            role="button"
            tabIndex={0}
            className={`node-hover-btn run${isLive ? " live" : ""}`}
            title={isLive ? `Stop ${data.id}` : `Run from ${data.id} and connected downstream steps`}
            onClick={handleRunFromNode}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.stopPropagation();
                handleRunFromNode(e as any);
              }
            }}
            aria-label={isLive ? `Stop ${data.id}` : `Run from ${data.id}`}
          >
            {isLive ? <StopIcon /> : <PlayIcon />}
          </span>
          <span
            role="button"
            tabIndex={0}
            className="node-hover-btn del"
            title={`Delete step ${data.id}`}
            onClick={handleDelete}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.stopPropagation();
                handleDelete(e as any);
              }
            }}
            aria-label={`Delete ${data.id}`}
          >
            <TrashIcon />
          </span>
        </span>
      </span>
      <span className="card-body">
        {data.attemptId && data.figurePort ? (
          <CardFigure
            attemptId={data.attemptId}
            port={data.figurePort}
            fact={
              <span className="card-fact">
                <NodeFact attemptId={data.attemptId} operator={data.operatorRef} metricsPort={data.metricsPort} status="" />
              </span>
            }
            fallback={<CardSummary data={data} />}
          />
        ) : (
          <CardSummary data={data} />
        )}
      </span>
      <span className={`card-status tone-${status.tone}`}>
        <span className="dot" aria-hidden="true" />
        {status.text}
        {data.concerns > 0 && (
          <span className="card-concern">⚠ {checkCount(data.concerns)}</span>
        )}
      </span>
      <Handle id="out" type="source" position={Position.Right} isConnectable={false} />
      <Handle id="top" type="target" position={Position.Top} isConnectable={false} />
      <Handle id="down" type="source" position={Position.Bottom} isConnectable={false} />
    </button>
  );
}

/** What a card shows of a step that drew no figure: a fact about its output and a small
 * picture of it. */
function CardSummary({ data }: { data: StepData }) {
  return (
    <div className="card-summary">
      {/* In Detail, an evaluator's metric is drawn large below; do not repeat it. */}
      {!(data.level === "detail" && data.isEvaluator) && (
        <span className="card-fact">
          {data.attemptId ? (
            <NodeFact attemptId={data.attemptId} operator={data.operatorRef} metricsPort={data.metricsPort} status="output saved" />
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
          metricsPort={data.metricsPort}
        />
      )}
    </div>
  );
}

/** An evaluator's metrics port, if it has one; absent otherwise (no undefined in node data). */
function metricsPortOf(op: Operator): { metricsPort?: string } {
  const port = op.outputs.find((o) => o.kind === "metrics")?.name;
  return port === undefined ? {} : { metricsPort: String(port) };
}

/** Width of the round icon in Compact (.round-icon) - 34px disc node glyph. */
const ROUND_ICON = 30;

/** Compact: a round icon, the step's name and what it is for beside it; its state is a dot. */
function CompactNode({ data }: NodeProps<Node<StepData>>) {
  const select = useSelection((s) => s.selectNode);
  const { pipelineVersionId, runId } = useSelection();
  const versions = usePipelineVersions();
  const pipeline = versions.data?.find((v) => v.id === pipelineVersionId);
  const saveAndRun = useSaveAndRun(runId);
  const startRun = useStartRun();

  const status = statusOf(data.state);
  const isLive = status.tone === "live";
  const bad = status.tone === "bad" || data.concerns > 0;

  const handleRunFromNode = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (pipelineVersionId) {
      startRun.mutate(pipelineVersionId);
    }
  };

  const showRun = useSelection((s) => s.showRun);
  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!pipeline) return;
    const readers = readersOf(pipeline, data.id);
    if (readers.length > 0) {
      alert(`Step "${data.id}" cannot be deleted because it is read by: ${readers.join(", ")}`);
      return;
    }
    const next = removeStep(pipeline, data.id);
    saveAndRun.mutate(next, {
      onSuccess: (r) => {
        select(undefined);
        showRun(next.id, r.id);
      },
    });
  };

  return (
    <button
      type="button"
      className={`flow-round${data.selected ? " selected" : ""}${bad ? " bad" : ""}`}
      aria-label={`${data.id}, ${data.title}, ${status.text}`}
      title={data.operatorRef}
      onClick={() => select(data.id)}
      onKeyDown={(e) => {
        if (e.key === "Delete" || e.key === "Backspace") handleDelete(e as any);
      }}
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
        <span className="node-title">{data.title}</span>
        <span className="round-sub">
          {/* Once the step ran, one measured fact about its output, as the design shows. */}
          {data.attemptId ? (
            <NodeFact attemptId={data.attemptId} operator={data.operatorRef} metricsPort={data.metricsPort} status={data.subject} />
          ) : (
            data.subject
          )}
          {data.edited && " · edited"}
        </span>
        {/* Only what needs attention gets words; a finished step is just its dot. */}
        {(status.tone === "bad" || status.tone === "live") && <span className={`round-state tone-${status.tone}`}>{status.text}</span>}
        {data.concerns > 0 && <span className="round-state tone-bad">⚠ {checkCount(data.concerns)}</span>}
      </span>
      <span className={`compact-hover-actions${isLive ? " has-live" : ""}`}>
        <span
          role="button"
          tabIndex={0}
          className={`node-hover-btn run${isLive ? " live" : ""}`}
          title={isLive ? `Stop ${data.id}` : `Run from ${data.id}`}
          onClick={handleRunFromNode}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.stopPropagation();
              handleRunFromNode(e as any);
            }
          }}
          aria-label={isLive ? `Stop ${data.id}` : `Run from ${data.id}`}
        >
          {isLive ? <StopIcon /> : <PlayIcon />}
        </span>
        <span
          role="button"
          tabIndex={0}
          className="node-hover-btn del"
          title={`Delete step ${data.id}`}
          onClick={handleDelete}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.stopPropagation();
              handleDelete(e as any);
            }
          }}
          aria-label={`Delete ${data.id}`}
        >
          <TrashIcon />
        </span>
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
  return <BaseEdge id={id} path={path} className={`flow-edge${data?.active ? " active" : ""}${data?.failed ? " failed" : ""}`} />;
}

/** Fit the flow to the panel with a thin margin, so steps stay readable. */
const FIT = { padding: 0.08, maxZoom: 1 };

const nodeTypes = { step: StepNode, stage: StageHead };
const edgeTypes = { flow: FlowEdge };

const LABEL_MAX = 300;

/** A compact node has standardized 184x52 card size matching Flow Studio spec; Detail cards have 248x176 size. */
function sizeOf(level: DetailLevel, _node: PipelineVersion["nodes"][number]) {
  return NODE_SIZE[level];
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
  const groupOf = stageGroups(pipeline, operators);
  const selectedGroup = selectedId ? groupOf.get(selectedId) : undefined;
  const heads: Node[] = groups.map((g) => {
    const stageNodes = pipeline.nodes.filter((n) => groupOf.get(n.id) === g.id);
    let completed = 0;
    let running = 0;
    let failed = 0;
    for (const n of stageNodes) {
      const att = latest.get(n.id);
      const st = statusOf(att?.state ?? "not run");
      if (st.tone === "live") running++;
      else if (st.tone === "bad") failed++;
      else if (st.tone === "good") completed++;
    }
    return {
      id: `stage:${g.id}`,
      type: "stage",
      position: { x: Math.round(g.x), y: Math.round(g.y) },
      width: Math.round(g.width),
      height: Math.round(g.height),
      // The heading is the handle: dragging it moves every step of the group (React Flow sub-flow).
      draggable: true,
      dragHandle: ".stage-head",
      selectable: true,
      zIndex: 0,
      data: {
        name: g.id.split("#")[0] ?? g.id,
        count: g.count,
        active: g.id === selectedGroup,
        baseWidth: Math.round(g.width),
        baseHeight: Math.round(g.height),
        completed,
        running,
        failed,
      },
    };
  });
  const boxes = new Map(groups.map((g) => [g.id, g]));
  const steps: Node[] = pipeline.nodes.map((node) => {
    const id = node.id;
    const box = boxes.get(groupOf.get(id) ?? "");
    const point = at.get(id) ?? { x: 0, y: 0 };
    const op = operators.get(node.operator);
    const { width, height } = sizeOf(level, node);
    return {
      id,
      type: "step",
      ...(box
        ? { parentId: `stage:${box.id}`, position: { x: Math.round(point.x - box.x), y: Math.round(point.y - box.y) } }
        : { position: { x: Math.round(point.x), y: Math.round(point.y) } }),
      width: Math.round(width),
      height: Math.round(height),
      zIndex: 1,
      data: {
        id,
        operator: shortName(node.operator),
        ...stepLabel(node),
        operatorRef: node.operator,
        capability: op?.capability_class ?? "",
        params: node.params,
        pipelineVersionId: pipeline.id,
        isEvaluator: op?.capability_class === "evaluator",
        ...(op?.capability_class === "evaluator" ? metricsPortOf(op) : {}),
        concerns: concerns.get(id) ?? 0,
        level,
        kind: op ? kindOf(op) : "recipe",
        role: op ? roleOf(op) : "Step",
        edited: node.code !== undefined,
        state: latest.get(id)?.state ?? "not run",
        ...(hasOutputs(latest.get(id)) ? { attemptId: latest.get(id)?.id } : {}),
        ...(op && figurePortOf(op) ? { figurePort: figurePortOf(op) } : {}),
        selected: id === selectedId,
      },
    };
  });
  const nodes = [...heads, ...steps];
  const edges: Edge[] = pipeline.edges.map((e) => {
    const source = stepOf(e.from);
    const target = stepOf(e.to);
    const sameStage = groupOf.has(source) && groupOf.get(source) === groupOf.get(target);
    const isFailed = (concerns.get(target) ?? 0) > 0 || latest.get(target)?.state === "failed";
    return {
      id: `${e.from}->${e.to}`,
      type: "flow",
      source,
      target,
      sourceHandle: sameStage ? "down" : "out",
      targetHandle: sameStage ? "top" : "in",
      data: {
        active: selectedId !== undefined && (source === selectedId || target === selectedId),
        failed: isFailed,
      },
    };
  });
  return { nodes, edges };
}

/** Layout runs off the main path (ELK is async); a new flow or node size lays out afresh. */
function usePositions(pipeline: PipelineVersion | undefined, level: DetailLevel, operators: Map<string, Operator>) {
  // Sizes depend on each step's role, so lay out again once the operators are known.
  // Lay out again only when the shape changes: an edit to settings keeps every position.
  const shape = pipeline
    ? JSON.stringify([pipeline.nodes.map((n) => [n.id, n.operator]), pipeline.edges.map((e) => [e.from, e.to])])
    : "";
  const key = pipeline ? `${shape}/${level}/${operators.size}` : "";
  const [result, setResult] = useState<{
    key: string;
    pipeline: PipelineVersion;
    at?: Map<string, Point>;
    groups?: Group[];
    error?: string;
  }>();
  useEffect(() => {
    if (!pipeline) return;
    let live = true;
    const groups = stageGroups(pipeline, operators);
    flowPositions(
      pipeline,
      (node) => sizeOf(level, node),
      (id) => groups.get(id),
    ).then(
      ({ nodes: at, groups }) => live && setResult({ key, pipeline, at, groups }),
      (e: unknown) => live && setResult({ key, pipeline, error: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      live = false;
    };
    // `key` names the pipeline version and size; versions are immutable.
  }, [key]);
  // While a new shape is laid out, keep drawing the last laid-out flow, so no step appears
  // without a position and then jumps. Once current, draw the flow as it is now.
  if (!result || !pipeline) return result;
  return result.key === key ? { ...result, pipeline } : result;
}

export function FlowCanvas() {
  const { pipelineVersionId, runId, nodeId } = useSelection();
  const versions = usePipelineVersions();
  const operators = useOperators();
  const attempts = useRunAttempts(pipelineVersionId, runId);
  const level = useCanvasDetail((s) => s.level);
  const checks = useRunChecks(attempts.data ?? []);

  // Chart steps are views inside the step they draw, never canvas steps.
  const found = versions.data?.find((v) => v.id === pipelineVersionId);
  const pipelineNow = found;
  const positions = usePositions(pipelineNow, level, new Map((operators.data ?? []).map((op) => [op.id, op])));
  if (versions.isError) return <p role="alert" className="error pad">{versions.error.message}</p>;
  if (operators.isError) return <p role="alert" className="error pad">{operators.error.message}</p>;
  if (versions.isPending || operators.isPending) return <Loading text="Loading flow…" pad />;
  const pipeline = pipelineNow;
  if (!pipeline) return <p className="muted pad">No flow yet. Submit one with <code>sprisk run</code>.</p>;

  const byRef = new Map(operators.data.map((op) => [op.id, op]));
  const latest = latestByNode(attempts.data ?? []);
  if (positions?.error) return <p role="alert" className="error pad">Could not lay out the flow: {positions.error}</p>;
  if (!positions?.at) return <Loading text="Laying out the flow…" pad />;
  const computed = flowGraph(positions.pipeline, byRef, latest, nodeId, level, concernsByNode(checks), positions.at, positions.groups);
  return (
    <div className="flow" aria-label="Flow canvas">
      {attempts.isError && <p role="alert" className="error pad">{attempts.error.message}</p>}
      {/* A new layout means new positions: start the canvas afresh. */}
      <Canvas computed={computed} level={level} pipeline={pipeline} />
      <StepMenu pipeline={pipeline} operators={byRef} />
    </div>
  );
}

export function encapsulateStages(nodes: Node[]): Node[] {
  const boundsByParent = new Map<string, { maxRight: number; maxBottom: number }>();
  for (const n of nodes) {
    if (n.parentId && n.position) {
      const w = n.width ?? NODE_SIZE.compact.width;
      const h = n.height ?? NODE_SIZE.compact.height;
      const right = n.position.x + w;
      const bottom = n.position.y + h;
      const cur = boundsByParent.get(n.parentId) ?? { maxRight: 0, maxBottom: 0 };
      boundsByParent.set(n.parentId, {
        maxRight: Math.max(cur.maxRight, right),
        maxBottom: Math.max(cur.maxBottom, bottom),
      });
    }
  }

  return nodes.map((node) => {
    if (node.type === "stage" || node.id.startsWith("stage:")) {
      const bounds = boundsByParent.get(node.id);
      if (!bounds) return node;
      const baseW = ((node.data as any)?.baseWidth as number | undefined) ?? node.width ?? MIN_STAGE_CARD_WIDTH;
      const baseH = ((node.data as any)?.baseHeight as number | undefined) ?? node.height ?? MIN_STAGE_CARD_HEIGHT;
      const neededWidth = Math.round(Math.max(baseW, bounds.maxRight + STAGE_PAD_X));
      const neededHeight = Math.round(Math.max(baseH, bounds.maxBottom + STAGE_FOOTER_HEIGHT + 24));
      if (node.width !== neededWidth || node.height !== neededHeight) {
        return {
          ...node,
          width: neededWidth,
          height: neededHeight,
          style: { ...(node.style || {}), width: neededWidth, height: neededHeight },
        };
      }
    }
    return node;
  });
}

type CanvasSnapshot = {
  positions: Map<string, Point>;
  dimensions: Map<string, { width?: number | undefined; height?: number | undefined }>;
  dragged: Set<string>;
};

/** Nodes can be dragged and the canvas panned. A dragged node keeps its place while its
 * status keeps updating. Positions are view state only; they are not saved (rule 9). */
function Canvas({ computed, level, pipeline }: { computed: { nodes: Node[]; edges: Edge[] }; level: DetailLevel; pipeline?: PipelineVersion }) {
  const selectNode = useSelection((s) => s.selectNode);
  const selectedNodeId = useSelection((s) => s.nodeId);
  const runId = useSelection((s) => s.runId);
  const showRun = useSelection((s) => s.showRun);
  const saveAndRun = useSaveAndRun(runId);
  const [nodes, setNodes] = useState<Node[]>(() => encapsulateStages(computed.nodes));
  const nodesRef = useRef<Node[]>(nodes);
  nodesRef.current = nodes;

  // Steps the user dragged keep their place; every other step follows the layout. The canvas
  // is updated in place, never remounted, so zoom and pan stay (ADR-0027 loading rules).
  const dragged = useRef(new Set<string>());
  const [undoStack, setUndoStack] = useState<CanvasSnapshot[]>([]);
  const [redoStack, setRedoStack] = useState<CanvasSnapshot[]>([]);
  const isDraggingRef = useRef(false);
  const dragStartSnapshot = useRef<CanvasSnapshot | null>(null);

  useEffect(() => {
    dragged.current.clear();
    setUndoStack([]);
    setRedoStack([]);
  }, [level]);

  const key = JSON.stringify(computed.nodes.map((n) => [n.id, n.data, n.position, n.parentId]));
  useEffect(() => {
    const updated = keepDragged(computed.nodes, nodesRef.current, dragged.current);
    const encapsulated = encapsulateStages(updated);
    nodesRef.current = encapsulated;
    setNodes(encapsulated);
    // `key` captures every change to the computed nodes and their layout.
  }, [key]);

  const captureSnapshot = (): CanvasSnapshot => {
    const positions = new Map<string, Point>();
    const dimensions = new Map<string, { width?: number | undefined; height?: number | undefined }>();
    for (const n of nodesRef.current) {
      positions.set(n.id, { ...n.position });
      dimensions.set(n.id, { width: n.width, height: n.height });
    }
    return { positions, dimensions, dragged: new Set(dragged.current) };
  };

  const applySnapshot = (snap: CanvasSnapshot) => {
    dragged.current = new Set(snap.dragged);
    setNodes((current) => {
      const updated = current.map((n) => {
        const savedPos = snap.positions.get(n.id);
        const savedDim = snap.dimensions.get(n.id);
        const nextNode = { ...n };
        if (savedPos) {
          nextNode.position = { ...savedPos };
        }
        if (savedDim?.width !== undefined) {
          nextNode.width = savedDim.width;
        }
        if (savedDim?.height !== undefined) {
          nextNode.height = savedDim.height;
        }
        if (savedDim?.width !== undefined || savedDim?.height !== undefined) {
          nextNode.style = {
            ...nextNode.style,
            ...(savedDim?.width !== undefined ? { width: savedDim.width } : {}),
            ...(savedDim?.height !== undefined ? { height: savedDim.height } : {}),
          };
        }
        return nextNode;
      });
      const finalNodes = encapsulateStages(updated);
      nodesRef.current = finalNodes;
      return finalNodes;
    });
  };

  const undo = () => {
    if (undoStack.length === 0) return;
    const currentSnap = captureSnapshot();
    const prevSnap = undoStack[undoStack.length - 1];
    if (!prevSnap) return;

    setUndoStack((prev) => prev.slice(0, -1));
    setRedoStack((prev) => [...prev, currentSnap]);
    applySnapshot(prevSnap);
  };

  const redo = () => {
    if (redoStack.length === 0) return;
    const currentSnap = captureSnapshot();
    const nextSnap = redoStack[redoStack.length - 1];
    if (!nextSnap) return;

    setRedoStack((prev) => prev.slice(0, -1));
    setUndoStack((prev) => [...prev, currentSnap]);
    applySnapshot(nextSnap);
  };

  const tidy = () => {
    const currentSnap = captureSnapshot();
    setUndoStack((prev) => [...prev, currentSnap]);
    setRedoStack([]);
    dragged.current.clear();
    const resetNodes = encapsulateStages(computed.nodes);
    nodesRef.current = resetNodes;
    setNodes(resetNodes);
  };

  const undoRef = useRef(undo);
  undoRef.current = undo;
  const redoRef = useRef(redo);
  redoRef.current = redo;

  const finishDrag = () => {
    if (isDraggingRef.current && dragStartSnapshot.current) {
      const startSnap = dragStartSnapshot.current;
      isDraggingRef.current = false;
      dragStartSnapshot.current = null;

      const anyMoved = nodesRef.current.some((n) => {
        const orig = startSnap.positions.get(n.id);
        return orig && (orig.x !== n.position.x || orig.y !== n.position.y);
      });

      if (anyMoved) {
        setUndoStack((prev) => [...prev, startSnap]);
        setRedoStack([]);
      }
    }
  };

  const handleNodesChange = (changes: NodeChange[]) => {
    const hasDragging = changes.some((c) => c.type === "position" && c.dragging === true);
    if (hasDragging && !isDraggingRef.current) {
      isDraggingRef.current = true;
      dragStartSnapshot.current = captureSnapshot();
    }

    const dragEnded = changes.some((c) => c.type === "position" && c.dragging === false);

    setNodes((current) => {
      let next = applyNodeChanges(changes, current);

      // Clamp child node positions inside their parent stage card so they never collide with the header
      next = next.map((n) => {
        if (n.parentId && n.position) {
          const clampedX = Math.max(STAGE_PAD_X, Math.round(n.position.x));
          const clampedY = Math.max(STAGE_HEAD_HEIGHT, Math.round(n.position.y));
          if (n.position.x !== clampedX || n.position.y !== clampedY) {
            return { ...n, position: { x: clampedX, y: clampedY } };
          }
        }
        return n;
      });

      // Dynamically adjust stage dimensions to encapsulate all children
      next = encapsulateStages(next);
      nodesRef.current = next;
      return next;
    });

    if (dragEnded) {
      finishDrag();
    }
  };

  const onNodeDragStart = () => {
    if (!isDraggingRef.current) {
      isDraggingRef.current = true;
      dragStartSnapshot.current = captureSnapshot();
    }
  };

  const onNodeDragStop = (_: unknown, node: Node) => {
    dragged.current.add(node.id);
    finishDrag();
  };

  useEffect(() => {
    const handleKeyDown = (e: globalThis.KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        (e.target as HTMLElement)?.isContentEditable
      ) {
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) {
          redoRef.current();
        } else {
          undoRef.current();
        }
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redoRef.current();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedNodeId && pipeline) {
          e.preventDefault();
          const readers = readersOf(pipeline, selectedNodeId);
          if (readers.length > 0) {
            alert(`Step "${selectedNodeId}" cannot be deleted because it is read by: ${readers.join(", ")}`);
            return;
          }
          const next = removeStep(pipeline, selectedNodeId);
          saveAndRun.mutate(next, {
            onSuccess: (r) => {
              selectNode(undefined);
              showRun(next.id, r.id);
            },
          });
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedNodeId, pipeline, saveAndRun, selectNode, showRun]);

  const onPaneClick = () => {
    selectNode(undefined);
    setNodes((current) => {
      const hasSelected = current.some((n) => n.selected || (n.data as any)?.selected);
      if (!hasSelected) return current;
      const cleared = current.map((n) => ({
        ...n,
        selected: false,
        data: n.data ? { ...n.data, selected: false } : n.data,
      }));
      nodesRef.current = cleared;
      return cleared;
    });
  };

  return (
    <ReactFlow
      nodes={nodes}
      edges={computed.edges}
      onNodesChange={handleNodesChange}
      onNodeDragStart={onNodeDragStart}
      onNodeDragStop={onNodeDragStop}
      onPaneClick={onPaneClick}
      onNodeClick={(_event, node) => {
        if (node.type === "step") {
          selectNode(node.id);
        } else if (node.type === "stage") {
          selectNode(undefined);
        }
      }}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      fitView
      fitViewOptions={FIT}
      nodesConnectable={false}
      minZoom={0.3}
      maxZoom={2}
      proOptions={{ hideAttribution: true }}
      colorMode="dark"
    >
      {/* React Flow sizes a dot by its diameter; the design's 1px-radius dots are 2px across. */}
      <Background variant={BackgroundVariant.Dots} gap={16} size={2} color="rgba(255,255,255,0.06)" />
      <Panel position="bottom-left" className="canvas-controls">
        <ZoomControl
          tidy={tidy}
          undo={undo}
          redo={redo}
          canUndo={undoStack.length > 0}
          canRedo={redoStack.length > 0}
        />
        <DetailSwitch />
      </Panel>
    </ReactFlow>
  );
}

function ZoomControl({
  tidy,
  undo,
  redo,
  canUndo,
  canRedo,
}: {
  tidy: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}) {
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  const { zoom } = useViewport();
  return (
    <div className="flow-zoom-bar zoom" role="group" aria-label="Zoom controls">
      <button type="button" className="flow-zoom-btn" aria-label="Undo" title="Undo (Ctrl+Z / ⌘Z)" disabled={!canUndo} onClick={undo}>
        <UndoIcon />
      </button>
      <button type="button" className="flow-zoom-btn" aria-label="Redo" title="Redo (Ctrl+Shift+Z / ⌘⇧Z / ⌘Y)" disabled={!canRedo} onClick={redo}>
        <RedoIcon />
      </button>
      <span className="zoom-sep" aria-hidden="true" />
      <button type="button" className="flow-zoom-btn" aria-label="Zoom out" onClick={() => void zoomOut()}>
        −
      </button>
      <span className="zoom-label">{Math.round(zoom * 100)}%</span>
      <button type="button" className="flow-zoom-btn" aria-label="Zoom in" onClick={() => void zoomIn()}>
        +
      </button>
      <span className="zoom-sep" aria-hidden="true" />
      <button type="button" className="flow-zoom-text-btn fit" onClick={() => void fitView(FIT)}>
        Fit
      </button>
      <span className="zoom-sep" aria-hidden="true" />
      <button
        type="button"
        className="flow-zoom-text-btn fit"
        title="Put every step back where the layout places it, then fit"
        onClick={() => {
          tidy();
          requestAnimationFrame(() => void fitView(FIT));
        }}
      >
        Tidy
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
  const saveAndRun = useSaveAndRun(useSelection((s) => s.runId));
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (at) first.current?.focus();
  }, [at]);
  useEscape(() => set(undefined), at !== undefined);
  if (!at) return saveAndRun.isError ? <p role="alert" className="error canvas-error">{saveAndRun.error.message}</p> : null;
  const node = pipeline.nodes.find((n) => n.id === at.nodeId);
  const tablePort = node ? operators.get(node.operator)?.outputs.find((o) => o.kind === "table")?.name : undefined;
  const readers = readersOf(pipeline, at.nodeId);
  const close = () => set(undefined);
  const act = (fn: () => void) => () => {
    fn();
    close();
  };
  // Rendered at the top of the page: inside a dock panel it would sit under other panels.
  return createPortal(
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
        <button
          type="button"
          role="menuitem"
          disabled={saveAndRun.isPending || readers.length > 0}
          title={readers.length > 0 ? `Read by ${readers.join(", ")}: remove those first` : undefined}
          onClick={act(() => {
            const version = removeStep(pipeline, at.nodeId);
            saveAndRun.mutate(version, { onSuccess: (r) => showRun(version.id, r.id) });
          })}
        >
          Remove step
        </button>
      </div>
    </div>,
    document.body,
  );
}
