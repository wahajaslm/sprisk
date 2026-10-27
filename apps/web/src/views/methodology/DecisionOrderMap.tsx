import "@xyflow/react/dist/style.css";

import { Background, BackgroundVariant, type Edge, Handle, MarkerType, type Node, type NodeProps, Position, ReactFlow } from "@xyflow/react";
import type { Method } from "@sprisk/contracts";
import { useEffect, useState } from "react";

import { Loading } from "../../components/ui/Loading.tsx";
import { type DecisionOrder, decisionOrder, effect, type MethodBox, type StageBox } from "./decisionOrder.ts";

type MethodNode = Node<{ box: MethodBox }, "method">;
type StageNode = Node<{ box: StageBox }, "stage">;

/** Every method in the order the engine decides them: stages top to bottom, a line from each
 * decision to the methods that wait for it, and under each method its choices and when it
 * takes each one. */
export function DecisionOrderMap({ methods, picked, onPick }: { methods: Method[]; picked: string | undefined; onPick: (id: string) => void }) {
  const [laid, setLaid] = useState<DecisionOrder>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let live = true;
    decisionOrder(methods).then(
      (order) => live && setLaid(order),
      (e: unknown) => live && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      live = false;
    };
  }, [methods]);
  if (error) return <p role="alert" className="error pad">{error}</p>;
  if (!laid) return <Loading text="Laying out the decisions…" />;

  const nodes: (MethodNode | StageNode)[] = [
    ...laid.stages.map((box): StageNode => ({ id: box.id, type: "stage", position: { x: box.x, y: box.y }, width: box.width, height: box.height, data: { box }, selectable: false })),
    ...laid.methods.map((box): MethodNode => ({ id: box.method.id, type: "method", parentId: box.stage, position: { x: box.x, y: box.y }, width: box.width, height: box.height, data: { box }, selected: box.method.id === picked })),
  ];
  const edges: Edge[] = laid.edges.map((e) => ({
    id: e.id,
    source: e.from,
    target: e.to,
    type: "smoothstep",
    markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
    className: "mth-order-edge",
  }));
  return (
    <div className="mth-map mth-order" role="region" aria-label="Decision order">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        onNodeClick={(_event, node) => {
          if (node.type === "method") onPick(node.id);
        }}
        fitView
        fitViewOptions={{ nodes: laid.stages.slice(0, 2).map((s) => ({ id: s.id })), maxZoom: 1, padding: 0.08 }}
        panOnScroll
        nodesDraggable={false}
        nodesConnectable={false}
        minZoom={0.2}
        maxZoom={1.5}
        proOptions={{ hideAttribution: true }}
        colorMode="dark"
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="rgba(255,255,255,0.08)" />
      </ReactFlow>
    </div>
  );
}

function StageCard({ data }: NodeProps<StageNode>) {
  return (
    <div className="mth-order-stage">
      <span className="mth-order-stage-title">{data.box.title}</span>
    </div>
  );
}

function MethodCard({ data, selected }: NodeProps<MethodNode>) {
  const { method, order } = data.box;
  return (
    // nopan: a click on a method picks it; it never starts a pan of the map.
    <button type="button" className="mth-order-method nopan" aria-pressed={selected} aria-label={method.name} title={method.pitfall}>
      <Handle type="target" position={Position.Top} isConnectable={false} />
      <span className="mth-order-head">
        <span className="mth-order-num">{order}</span>
        <span className="mth-order-name">{method.name}</span>
      </span>
      <span className="mth-order-question">{method.question}</span>
      <span className="mth-order-choices" role="list" aria-label={`Choices of ${method.name}`}>
        {method.options.map((option) => (
          <span key={option.id} className="mth-order-choice" role="listitem">
            <span className="mth-order-if">
              <b>if</b> {option.when}
            </span>
            <span className="mth-order-then">
              {option.label} <span className={effect(option) === "changes nothing" ? "nothing" : "acts"}>→ {effect(option)}</span>
            </span>
          </span>
        ))}
      </span>
      <Handle type="source" position={Position.Bottom} isConnectable={false} />
    </button>
  );
}

const NODE_TYPES = { stage: StageCard, method: MethodCard };
