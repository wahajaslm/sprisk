import "@xyflow/react/dist/style.css";

import type { Attempt, FlowDecision, Operator, PipelineVersion, PromiseStatus } from "@sprisk/contracts";
import {
  applyNodeChanges,
  Background,
  BackgroundVariant,
  BaseEdge,
  type Edge,
  type EdgeProps,
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

import { useOperators, usePipelineVersions, useRunAttempts, useSaveAndRun } from "../api/hooks.ts";
import { checkCount, concernsByNode, useRunChecks } from "../api/checks.ts";
import { hasOutputs, latestByNode, statusOf } from "../flow/latest.ts";
import { DETAIL_LEVELS, type DetailLevel, NODE_SIZE, useCanvasDetail } from "../workbench/detail.ts";
import { NodeVisual } from "./NodeVisual.tsx";
import { CardFigure } from "./CardFigure.tsx";
import { addCodeStep, readersOf } from "../flow/edit.ts";
import { useCanvasNotice, useStepActions } from "./flow/useStepActions.ts";
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
import { figurePortOf, kindOf, metricsPort, type NodeKind, roleOf, shortName, STAGE_PURPOSE, STAGE_TITLE, type Stage, stepLabel, type StepOrigin, stepOrigin } from "../flow/stages.ts";
import type { InspectorTab } from "../workbench/inspectorTabs.ts";
import { useWorkbench } from "../workbench/workbench.ts";
import { NodeFact } from "./NodeFact.tsx";
import { useSelection } from "../workbench/selection.ts";
import { ink, P } from "../styles/palette.ts";
import { useNotebooks } from "../api/notebooks.ts";
import { KindIcon, NotebookIcon, PlayIcon, RedoIcon, RestartIcon, TrashIcon, UndoIcon } from "./Icons.tsx";
import { Button } from "../components/ui/Button.tsx";
import { Loading } from "../components/ui/Loading.tsx";
import { useEscape } from "../hooks/useEscape.ts";
import { stageGroups, stageNotebooks } from "../notebook/stageNotebooks.ts";
import { useFlowDecisions } from "../api/walks.ts";
import { STANDING } from "./PromiseList.tsx";
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
  /** Where the step comes from, shown by its shape (ADR-0063). */
  origin: StepOrigin;
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
  /** Under the name: what the stage is for, or what its decisions chose (ADR-0063). */
  purpose: string;
  /** The promises its decisions made, with their standing on this version. */
  promises: PromiseStatus[];
  count: number;
  baseWidth?: number;
  baseHeight?: number;
};

/** A stage card, copied from the design's main screen: its name and step count, then one line on
 * what it is for. The header is the drag handle (`.stage-head`). */
function StageHead({ data }: NodeProps<Node<StageData>>) {
  const summary = data.promises.length > 0 ? promiseSummary(data.promises) : undefined;
  return (
    <div role="region" aria-label={`Stage ${data.name}`} style={{ width: "100%", height: "100%", boxSizing: "border-box", background: "var(--bg-card,#171717)", borderRadius: "var(--r-lg,10px)", padding: "12px 12px 0", display: "flex", flexDirection: "column", gap: "4px" }}>
      <div className="stage-head" title={`Stage: ${data.name} (${data.count} steps)`} style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "8px", cursor: "grab" }}>
        <h3 style={{ margin: "0", fontSize: "14px", fontWeight: "500", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{data.name}</h3>
        {/* A stage's promises take the step count's place (ADR-0063). */}
        {summary ? (
          <span title={data.promises.map((p) => `${p.promise} ${STANDING[p.status].word}.`).join(" ")} style={{ fontSize: "11.5px", color: STANDING[summary.status].tone === "bad" ? P.red : P.t3, whiteSpace: "nowrap" }}>
            {summary.text}
          </span>
        ) : (
          <span style={{ fontSize: "11.5px", color: P.t3, whiteSpace: "nowrap" }}>{data.count} {data.count === 1 ? "step" : "steps"}</span>
        )}
      </div>
      <span title={data.purpose} style={{ fontSize: "11.5px", color: "var(--t-label,#959595)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {data.purpose}
      </span>
    </div>
  );
}

/** A stage's promises in one badge: "2 hold" when all do, else how many stand worst. The
 * tooltip lists each one. */
function promiseSummary(promises: PromiseStatus[]): { status: PromiseStatus["status"]; text: string } {
  const worst = (["fail", "stale", "inconclusive", "not_evaluated"] as const).find((s) => promises.some((p) => p.status === s));
  if (!worst) return { status: "pass", text: `${promises.length} hold` };
  const n = promises.filter((p) => p.status === worst).length;
  return { status: worst, text: `${n} ${STANDING[worst].word.toLowerCase()}` };
}

/** What a step's shape means, in its tooltip and for screen readers. */
const ORIGIN_TEXT: Record<StepOrigin, string> = {
  decided: "chosen by a method",
  measures: "measures evidence for a method",
  written: "operator step",
};

/** "Explore#explore" → "Explore": stageGroups names each group by its stage. */
const stageOfGroup = (id: string) => (id.split("#")[0] ?? id) as Stage;

/** An edge into or out of the selected step is drawn brighter; failed gate is dashed red. */
type FlowEdgeData = { active: boolean; failed?: boolean };

function StepNode(props: NodeProps<Node<StepData>>) {
  return props.data.level === "compact" ? <CompactNode {...props} /> : <CardNode {...props} />;
}

function CardNode({ data }: NodeProps<Node<StepData>>) {
  const select = useSelection((s) => s.selectNode);
  const pipelineVersionId = useSelection((s) => s.pipelineVersionId);
  const versions = usePipelineVersions();
  const pipeline = versions.data?.find((v) => v.id === pipelineVersionId);
  const actions = useStepActions(pipeline);

  const status = statusOf(data.state);
  const isLive = status.tone === "live";
  const { width, height } = NODE_SIZE[data.level];

  return (
    <button
      type="button"
      className={`flow-card${data.selected ? " selected" : ""}${status.tone === "bad" ? " bad" : ""}`}
      style={{ width, height }}
      aria-label={`${data.id}, ${data.title}, ${status.text}`}
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
        <span className="icon-tile small">
          <KindIcon kind={data.kind} size={13} />
        </span>
        <span className="card-title">{data.title}</span>
        <span className="card-op">
          {data.subject}
          {data.edited && " · edited"}
        </span>
        <span className={`node-hover-actions${isLive ? " has-live" : ""}`}>
          <StepButtons id={data.id} live={isLive} actions={actions} />
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

/** A step's hover buttons. No route stops a run, so a live step only says it is running. */
function StepButtons({ id, live, actions }: { id: string; live: boolean; actions: ReturnType<typeof useStepActions> }) {
  const readers = actions.readers(id);
  const press = (act: () => void) => ({
    onClick: (e: React.MouseEvent) => {
      e.stopPropagation();
      act();
    },
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.stopPropagation();
      act();
    },
  });
  // `nodrag`: pressing a step's button never starts dragging the step (React Flow).
  const runLabel = live ? `${id} is running` : `Run from ${id}`;
  const deleteTitle = readers.length > 0 ? `Read by ${readers.join(", ")}: remove those first` : `Delete step ${id}`;
  return (
    <>
      <span
        role="button"
        tabIndex={0}
        className={`node-hover-btn nodrag run${live ? " live" : ""}`}
        title={live ? runLabel : `${runLabel}: it and every step after it run again`}
        aria-label={runLabel}
        aria-disabled={live}
        {...press(() => {
          if (!live) actions.runFrom(id);
        })}
      >
        <PlayIcon />
      </span>
      <span
        role="button"
        tabIndex={0}
        className="node-hover-btn nodrag del"
        title={deleteTitle}
        aria-label={`Delete ${id}`}
        aria-disabled={readers.length > 0}
        {...press(() => actions.remove(id))}
      >
        <TrashIcon />
      </span>
    </>
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
  const port = metricsPort(op);
  return port === undefined ? {} : { metricsPort: port };
}

/** Width of the round icon in Compact (.round-icon); lines run down from its centre. */
const ROUND_ICON = 30;

/** The design's status dot by tone: done grey, live bright, failed red, not run dim. */
const DOT: Record<string, string> = { done: P.t3, live: P.t0, bad: P.red, idle: P.idle };

/** Compact: a round icon, the step's name and what it is for beside it; its state is a dot. */
function CompactNode({ data }: NodeProps<Node<StepData>>) {
  const select = useSelection((s) => s.selectNode);
  const pipelineVersionId = useSelection((s) => s.pipelineVersionId);
  const versions = usePipelineVersions();
  const pipeline = versions.data?.find((v) => v.id === pipelineVersionId);
  const actions = useStepActions(pipeline);

  const status = statusOf(data.state);
  const isLive = status.tone === "live";
  const bad = status.tone === "bad" || data.concerns > 0;
  const attention = [
    ...(status.tone === "bad" || isLive ? [status.text] : []),
    ...(data.concerns > 0 ? [`⚠ ${checkCount(data.concerns)}`] : []),
  ];

  return (
    <button
      type="button"
      className={`dx-btn flow-round shape-${data.origin}${data.selected ? " selected" : ""}${bad ? " bad" : ""}`}
      aria-label={`${data.id}, ${data.title}, ${ORIGIN_TEXT[data.origin]}, ${status.text}`}
      title={`${data.operatorRef} · ${ORIGIN_TEXT[data.origin]}`}
      onClick={() => select(data.id)}
      onContextMenu={(e) => {
        e.preventDefault();
        select(data.id);
        openStepMenu({ nodeId: data.id, x: e.clientX, y: e.clientY });
      }}
      style={{ position: "relative", width: "176px", height: "40px", display: "flex", alignItems: "center", gap: "10px", cursor: "pointer", borderRadius: "var(--r-sm,6px)" }}
    >
      <Handle id="in" type="target" position={Position.Left} isConnectable={false} />
      {/* The disc's fill is drawn by .round-icon::before, so its shape can say where the step comes from. */}
      <span className={`round-icon kind-${data.kind}${data.selected ? " dx-disc-on" : bad ? " dx-disc-warn" : ""}`} style={{ position: "relative", width: "30px", height: "30px", borderRadius: "50%", flexShrink: "0", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <KindIcon kind={data.kind} size={14} />
        <span className={`state-dot tone-${status.tone}`} role="img" aria-label={status.text} style={{ position: "absolute", right: "0", bottom: "0", width: "6px", height: "6px", borderRadius: "50%", boxShadow: "0 0 0 2px var(--bg-surface,#121212)", background: DOT[status.tone] ?? P.idle }} />
      </span>
      <span className="round-text" style={{ display: "flex", flexDirection: "column", gap: "2px", minWidth: "0" }}>
        <span className="node-title" style={{ fontSize: "12.5px", fontWeight: "500", color: bad ? P.red : P.t0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{data.title}</span>
        {/* Two lines, as the design draws a step. What needs attention takes the second line;
            otherwise, once the step ran, one measured fact about its output. */}
        <span className="round-sub" style={{ fontSize: "11.5px", color: bad ? P.red : P.t3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {attention.length > 0 ? (
            attention.join(" · ")
          ) : (
            <>
              {data.attemptId ? <NodeFact attemptId={data.attemptId} operator={data.operatorRef} metricsPort={data.metricsPort} status={data.subject} /> : data.subject}
              {data.edited && " · edited"}
            </>
          )}
        </span>
      </span>
      <span className={`compact-hover-actions${isLive ? " has-live" : ""}`}>
        <StepButtons id={data.id} live={isLive} actions={actions} />
      </span>
      {/* The design's node is 176px wide; a line leaves its right edge. */}
      <Handle id="out" type="source" position={Position.Right} isConnectable={false} />
      {/* Within a stage, lines run down from icon to icon. */}
      <Handle id="top" type="target" position={Position.Top} isConnectable={false} style={{ left: ROUND_ICON / 2 }} />
      <Handle id="down" type="source" position={Position.Bottom} isConnectable={false} style={{ left: ROUND_ICON / 2 }} />
    </button>
  );
}

/** The design's lines: straight down between the steps of one stage, a soft curve from one
 * stage to the next. A line touching the selected step is brighter; a failed gate's is red. */
function FlowEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, data }: EdgeProps<Edge<FlowEdgeData>>) {
  const path =
    sourcePosition === Position.Bottom
      ? `M${sourceX} ${sourceY}L${targetX} ${targetY}`
      : `M${sourceX} ${sourceY}C${sourceX + 34} ${sourceY} ${targetX - 34} ${targetY} ${targetX} ${targetY}`;
  return (
    <BaseEdge
      id={id}
      path={path}
      style={{ fill: "none", stroke: data?.failed ? P.red : ink(data?.active ? 0.5 : 0.18), strokeWidth: data?.active ? 1.3 : 1, strokeDasharray: data?.failed ? "4 3" : undefined }}
    />
  );
}

/** Fit the flow to the panel with a thin margin, so steps stay readable. */
const FIT = { padding: 0.08, maxZoom: 1 };
/** The design's main screen opens at 100%, the first stage card 20px in and 16px down; Fit
 * shows the whole flow on demand. The layout starts at (0, 0). */
const OPENING_VIEW = { x: 20, y: 16, zoom: 1 };

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
  decisions: FlowDecision[] = [],
): { nodes: Node[]; edges: Edge[] } {
  const groupOf = stageGroups(pipeline, operators, decisions);
  const decidedIn = new Map(stageNotebooks(pipeline, operators, decisions).map((s) => [s.name, s.decisions]));
  const heads: Node[] = groups.map((g) => {
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
        name: STAGE_TITLE[stageOfGroup(g.id)],
        // The decisions made here name what the stage did; a stage without one says what it is for.
        purpose: (decidedIn.get(stageOfGroup(g.id)) ?? []).map((d) => d.name).filter((n) => n !== STAGE_TITLE[stageOfGroup(g.id)]).join(" · ") || STAGE_PURPOSE[stageOfGroup(g.id)],
        promises: (decidedIn.get(stageOfGroup(g.id)) ?? []).flatMap((d) => d.promises),
        count: g.count,
        baseWidth: Math.round(g.width),
        baseHeight: Math.round(g.height),
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
        ...stepLabel(node, op),
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
        origin: stepOrigin(node, op),
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
    // Down only between steps of one column of a stage; into the next column, left to right.
    const sameColumn = groupOf.has(source) && groupOf.get(source) === groupOf.get(target) && at.get(source)?.x === at.get(target)?.x;
    const isFailed = (concerns.get(target) ?? 0) > 0 || latest.get(target)?.state === "failed";
    return {
      id: `${e.from}->${e.to}`,
      type: "flow",
      source,
      target,
      sourceHandle: sameColumn ? "down" : "out",
      targetHandle: sameColumn ? "top" : "in",
      data: {
        active: selectedId !== undefined && (source === selectedId || target === selectedId),
        failed: isFailed,
      },
    };
  });
  return { nodes, edges };
}

/** Layout runs off the main path (ELK is async); a new flow or node size lays out afresh. */
function usePositions(pipeline: PipelineVersion | undefined, level: DetailLevel, operators: Map<string, Operator>, decisions: FlowDecision[]) {
  // Sizes depend on each step's role, so lay out again once the operators are known.
  // Lay out again only when the shape changes: an edit to settings keeps every position.
  const shape = pipeline
    ? JSON.stringify([pipeline.nodes.map((n) => [n.id, n.operator]), pipeline.edges.map((e) => [e.from, e.to])])
    : "";
  // Decisions move steps into their activity's card, so the cards' members are part of the shape.
  const sections = JSON.stringify(decisions.map((d) => [d.activity, d.steps]));
  const key = pipeline ? `${shape}/${level}/${operators.size}/${sections}` : "";
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
    const groups = stageGroups(pipeline, operators, decisions);
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
  const decided = useFlowDecisions(pipelineVersionId);
  const decisions = decided.data?.decisions ?? [];
  const positions = usePositions(pipelineNow, level, new Map((operators.data ?? []).map((op) => [op.id, op])), decisions);
  if (versions.isError) return <p role="alert" className="error pad">{versions.error.message}</p>;
  if (operators.isError) return <p role="alert" className="error pad">{operators.error.message}</p>;
  // Decisions place steps in their activity's card: lay out once they are read, not twice.
  if (versions.isPending || operators.isPending || (pipelineVersionId && decided.isPending)) return <Loading text="Loading pipeline…" pad />;
  const pipeline = pipelineNow;
  if (!pipeline) return <p className="muted pad">No pipeline yet. Submit one with <code>sprisk run</code>.</p>;

  const byRef = new Map(operators.data.map((op) => [op.id, op]));
  const latest = latestByNode(attempts.data ?? []);
  if (positions?.error) return <p role="alert" className="error pad">Could not lay out the pipeline: {positions.error}</p>;
  if (!positions?.at) return <Loading text="Laying out the pipeline…" pad />;
  const computed = flowGraph(positions.pipeline, byRef, latest, nodeId, level, concernsByNode(checks), positions.at, positions.groups, decisions);
  return (
    <div className="flow" aria-label="Pipeline canvas">
      {attempts.isError && <p role="alert" className="error pad">{attempts.error.message}</p>}
      {decided.isError && <p role="alert" className="error pad">The pipeline's decisions could not be read, so steps show by stage only: {decided.error.message}</p>}
      {/* A new layout means new positions: start the canvas afresh. */}
      <Canvas computed={computed} level={level} pipeline={pipeline} />
      <StepMenu pipeline={pipeline} operators={byRef} />
      <CanvasNotice />
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
      const baseW = (node.data as Partial<StageData>).baseWidth ?? node.width ?? MIN_STAGE_CARD_WIDTH;
      const baseH = (node.data as Partial<StageData>).baseHeight ?? node.height ?? MIN_STAGE_CARD_HEIGHT;
      const neededWidth = Math.round(Math.max(baseW, bounds.maxRight + STAGE_PAD_X));
      const neededHeight = Math.round(Math.max(baseH, bounds.maxBottom + STAGE_FOOTER_HEIGHT));
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
  const stepActions = useStepActions(pipeline);
  const stepActionsRef = useRef(stepActions);
  stepActionsRef.current = stepActions;
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
          stepActionsRef.current.remove(selectedNodeId);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedNodeId, pipeline]);

  const onPaneClick = () => {
    selectNode(undefined);
    setNodes((current) => {
      const hasSelected = current.some((n) => n.selected || (n.data as Partial<StepData>).selected);
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
      defaultViewport={OPENING_VIEW}
      nodesConnectable={false}
      minZoom={0.3}
      maxZoom={2}
      proOptions={{ hideAttribution: true }}
      colorMode="dark"
    >
      {/* React Flow sizes a dot by its diameter; the design's 1px-radius dots are 2px across. */}
      <Background variant={BackgroundVariant.Dots} gap={16} size={2} color="rgba(255,255,255,0.06)" />
      <Panel position="bottom-left" style={{ margin: "12px", display: "flex", alignItems: "center", gap: "8px" }}>
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

/** The design's zoom bar: a small surface bar of 24px buttons split by hairlines. */
const ZOOM_BAR = { width: "max-content", display: "flex", alignItems: "center", gap: "2px", padding: "3px", borderRadius: "var(--r-md,8px)", background: "var(--bg-surface,#121212)", fontSize: "12px", color: "var(--t-secondary,#d4d4d4)" } as const;
const ZOOM_ICON_BUTTON = { width: "24px", height: "22px", display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "var(--r-sm,6px)", cursor: "pointer" } as const;
const ZOOM_TEXT_BUTTON = { padding: "0 7px", height: "22px", display: "flex", alignItems: "center", borderRadius: "var(--r-sm,6px)", cursor: "pointer" } as const;
const ZOOM_SEP = <span aria-hidden="true" style={{ width: "1px", height: "12px", background: "rgba(var(--ink-rgb,255,255,255),0.1)", margin: "0 3px" }} />;

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
    <div role="group" aria-label="Zoom controls" style={ZOOM_BAR}>
      <button type="button" className="dx-btn dx-h-06" aria-label="Undo" title="Undo (Ctrl+Z / ⌘Z)" disabled={!canUndo} onClick={undo} style={ZOOM_ICON_BUTTON}>
        <UndoIcon />
      </button>
      <button type="button" className="dx-btn dx-h-06" aria-label="Redo" title="Redo (Ctrl+Shift+Z / ⌘⇧Z / ⌘Y)" disabled={!canRedo} onClick={redo} style={ZOOM_ICON_BUTTON}>
        <RedoIcon />
      </button>
      {ZOOM_SEP}
      <button type="button" className="dx-btn dx-h-06" aria-label="Zoom out" onClick={() => void zoomOut()} style={ZOOM_ICON_BUTTON}>
        −
      </button>
      <span style={{ padding: "0 4px", fontVariantNumeric: "tabular-nums" }}>{Math.round(zoom * 100)}%</span>
      <button type="button" className="dx-btn dx-h-06" aria-label="Zoom in" onClick={() => void zoomIn()} style={ZOOM_ICON_BUTTON}>
        +
      </button>
      {ZOOM_SEP}
      <button type="button" className="dx-btn dx-h-06" onClick={() => void fitView(FIT)} style={ZOOM_TEXT_BUTTON}>
        Fit
      </button>
      {ZOOM_SEP}
      <button
        type="button"
        className="dx-btn dx-h-06"
        title="Put every step back where the layout places it, then fit"
        onClick={() => {
          tidy();
          requestAnimationFrame(() => void fitView(FIT));
        }}
        style={ZOOM_TEXT_BUTTON}
      >
        Tidy
      </button>
    </div>
  );
}

const DETAIL_LABEL: Record<DetailLevel, string> = { compact: "Compact", detail: "Detail" };

/** How much each node shows. Kept per browser; it never changes the flow. Drawn as the design's
 * segmented switch in a zoom bar. */
function DetailSwitch() {
  const { level, setLevel } = useCanvasDetail();
  return (
    <div role="radiogroup" aria-label="Node detail" style={ZOOM_BAR}>
      {DETAIL_LEVELS.map((l) => (
        <button key={l} type="button" role="radio" aria-checked={level === l} className="dx-btn dx-h-text" onClick={() => setLevel(l)} style={{ ...ZOOM_TEXT_BUTTON, padding: "0 9px", fontWeight: "500", background: level === l ? ink(0.1) : "transparent", color: level === l ? P.t0 : P.t3 }}>
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

/** Why a step action was refused or failed, until it is dismissed or the next action. */
function CanvasNotice() {
  const { notice, say } = useCanvasNotice();
  if (!notice) return null;
  return (
    <p role="alert" className="error canvas-error">
      {notice}{" "}
      <Button variant="ghost" size="sm" onClick={() => say(undefined)}>
        Dismiss
      </Button>
    </p>
  );
}

/** Right-click actions on a step. Escape or a click elsewhere closes it. */
function StepMenu({ pipeline, operators }: { pipeline: PipelineVersion; operators: Map<string, Operator> }) {
  const { at, set } = useStepMenu();
  const dock = useWorkbench((s) => s.dock);
  const { selectNode, showRun } = useSelection();
  const saveAndRun = useSaveAndRun(useSelection((s) => s.runId));
  const actions = useStepActions(pipeline);
  const say = useCanvasNotice((s) => s.say);
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (at) first.current?.focus();
  }, [at]);
  useEscape(() => set(undefined), at !== undefined);
  if (!at) return null;
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
              saveAndRun.mutate(version, {
                onSuccess: (r) => showRun(version.id, r.id, nodeId),
                onError: (error) => say(error.message),
              });
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
          disabled={actions.pending || readers.length > 0}
          title={readers.length > 0 ? `Read by ${readers.join(", ")}: remove those first` : undefined}
          onClick={act(() => actions.remove(at.nodeId))}
        >
          Remove step
        </button>
      </div>
    </div>,
    document.body,
  );
}
