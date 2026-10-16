import "@xyflow/react/dist/style.css";

import type { Attempt, Operator, PipelineVersion } from "@sprisk/contracts";
import { Background, Controls, type Edge, type Node, type NodeProps, ReactFlow, useNodesState } from "@xyflow/react";
import { useEffect } from "react";

import { useAttempts, useOperators, usePipelineVersions, useRuns } from "../api/hooks.ts";
import { latestByNode } from "../flow/latest.ts";
import { kindOf, type NodeKind, STAGES, type Stage, stageOf } from "../flow/stages.ts";
import { useSelection } from "../workbench/selection.ts";
import { shortName } from "./StepLibrary.tsx";

const COLUMN = 230;
const ROW = 70;
const TOP = 44;

type StepData = { id: string; operator: string; kind: NodeKind; state: string; selected: boolean };
type FrameData = { label: string; count: number; height: number };

function StepNode({ data }: NodeProps<Node<StepData>>) {
  const select = useSelection((s) => s.selectNode);
  return (
    <button
      type="button"
      className={`flow-node ${data.kind} state-${data.state}${data.selected ? " selected" : ""}`}
      onClick={() => select(data.id)}
    >
      <span className="node-title">{data.id}</span>
      <span className="node-sub">
        {data.operator} · {data.state}
      </span>
    </button>
  );
}

function StageFrame({ data }: NodeProps<Node<FrameData>>) {
  return (
    <div className="stage-frame" style={{ height: data.height }}>
      <span className="eyebrow">{data.label}</span>
      <span className="eyebrow muted">{data.count} steps</span>
    </div>
  );
}

const nodeTypes = { step: StepNode, frame: StageFrame };

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
    const stage = op ? stageOf(op) : "Clean";
    stageOfNode.set(n.id, stage);
    byStage.set(stage, [...(byStage.get(stage) ?? []), n.id]);
  }
  const used = STAGES.filter((s) => byStage.has(s));
  const nodes: Node[] = [];
  used.forEach((stage, col) => {
    const ids = byStage.get(stage) ?? [];
    nodes.push({
      id: `stage:${stage}`,
      type: "frame",
      position: { x: col * COLUMN, y: 0 },
      data: { label: `${String(STAGES.indexOf(stage) + 1).padStart(2, "0")} ${stage}`, count: ids.length, height: TOP + ids.length * ROW + 10 },
      width: 206,
      height: TOP + ids.length * ROW + 10,
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
        position: { x: col * COLUMN + 12, y: TOP + row * ROW },
        width: 182,
        height: 52,
        data: {
          id,
          operator: node ? shortName(node.operator) : id,
          kind: op ? kindOf(op) : "step",
          state: latest.get(id)?.state ?? "not run",
          selected: id === selectedId,
        },
      });
    });
  });
  const edges: Edge[] = pipeline.edges.map((e) => ({
    id: `${e.from}->${e.to}`,
    source: e.from.split(".")[0] ?? e.from,
    target: e.to.split(".")[0] ?? e.to,
    label: e.from.split(".")[1],
  }));
  return { nodes, edges };
}

export function FlowCanvas() {
  const { pipelineVersionId, runId, nodeId } = useSelection();
  const versions = usePipelineVersions();
  const operators = useOperators();
  const runs = useRuns(pipelineVersionId);
  const live = runs.data?.find((r) => r.id === runId)?.status === "running";
  const attempts = useAttempts(runId, live);

  if (versions.isError) return <p role="alert" className="error pad">{versions.error.message}</p>;
  if (operators.isError) return <p role="alert" className="error pad">{operators.error.message}</p>;
  if (versions.isPending || operators.isPending) return <p className="muted pad">Loading flow…</p>;
  const pipeline = versions.data.find((v) => v.id === pipelineVersionId);
  if (!pipeline) return <p className="muted pad">No pipeline yet. Submit one with <code>sprisk run</code>.</p>;

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
      fitView
      nodesConnectable={false}
      proOptions={{ hideAttribution: true }}
      colorMode="dark"
    >
      <Background gap={24} size={1} />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}
