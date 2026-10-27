import "@xyflow/react/dist/style.css";

import { Background, BackgroundVariant, Controls, type Edge, Handle, MarkerType, type Node, type NodeProps, Position, ReactFlow } from "@xyflow/react";
import type { Method, Operator } from "@sprisk/contracts";
import { useEffect, useState } from "react";

import { Loading } from "../../components/ui/Loading.tsx";
import { type DecisionOrder, decisionOrder, effect, MEASURE, type MeasureBox, type MethodBox, NODE, type StageBox } from "./decisionOrder.ts";

type MethodNode = Node<{ box: MethodBox }, "method">;
type StageNode = Node<{ box: StageBox }, "stage">;
type MeasureNode = Node<{ box: MeasureBox }, "measure">;

/** Every method in the order the engine decides them: stages top to bottom, one numbered
 * circle per method, a square for each measurement a method decides from, and a line from each
 * decision to the methods that wait for it. The picked method's question, choices and when it
 * takes each are in the card beside the canvas. */
export function DecisionOrderMap({ methods, operators, picked, onPick }: { methods: Method[]; operators: Operator[]; picked: string | undefined; onPick: (id: string) => void }) {
  const [laid, setLaid] = useState<DecisionOrder>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let live = true;
    decisionOrder(methods, operators).then(
      (order) => live && setLaid(order),
      (e: unknown) => live && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      live = false;
    };
  }, [methods, operators]);
  if (error) return <p role="alert" className="error pad">{error}</p>;
  if (!laid) return <Loading text="Laying out the decisions…" />;

  const current = laid.methods.find((m) => m.method.id === picked) ?? laid.methods[0];
  const nodes: (MethodNode | StageNode | MeasureNode)[] = [
    ...laid.stages.map((box): StageNode => ({ id: box.id, type: "stage", position: { x: box.x, y: box.y }, width: box.width, height: box.height, data: { box }, selectable: false })),
    ...laid.measures.map((box): MeasureNode => ({ id: box.id, type: "measure", parentId: box.stage, position: { x: box.x, y: box.y }, width: box.width, height: box.height, data: { box }, selectable: false })),
    ...laid.methods.map(
      (box): MethodNode => ({ id: box.method.id, type: "method", parentId: box.stage, position: { x: box.x, y: box.y }, width: box.width, height: box.height, data: { box }, selected: box.method.id === current?.method.id }),
    ),
  ];
  const edges: Edge[] = laid.edges.map((e) => ({
    id: e.id,
    source: e.from,
    target: e.to,
    type: "default",
    markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
    className: `mth-order-edge ${e.kind}`,
  }));
  return (
    <>
      <div className="mth-map mth-order" role="region" aria-label="Decision order">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          onNodeClick={(_event, node) => {
            if (node.type === "method") onPick(node.id);
          }}
          // Open readable, on the first stage; the rest is a pan or a scroll away.
          defaultViewport={{ x: 32, y: 32, zoom: 0.9 }}
          panOnScroll
          nodesDraggable={false}
          nodesConnectable={false}
          minZoom={0.2}
          maxZoom={1.5}
          proOptions={{ hideAttribution: true }}
          colorMode="dark"
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="rgba(255,255,255,0.08)" />
          <Controls position="bottom-left" showInteractive={false} />
        </ReactFlow>
      </div>
      {current && (
        <aside className="mth-card">
          <MethodDetail key={current.method.id} box={current} all={laid.methods} measures={laid.measures} onPick={onPick} />
        </aside>
      )}
    </>
  );
}

/** The picked method: its question, what it waits for, its choices with when each is taken,
 * and what it promises. */
function MethodDetail({ box, all, measures, onPick }: { box: MethodBox; all: MethodBox[]; measures: MeasureBox[]; onPick: (id: string) => void }) {
  const { method, order } = box;
  const starts = measures.filter((m) => m.stage === box.stage && method.needs.evidence.includes(m.kind));
  const asks = [...method.needs.concepts.map((c) => `the column that means ${c}`), ...(method.needs.statements ?? []).map((s) => `the question's ${s.replace("_", " ")}`)];
  const waits = method.needs.decisions.flatMap((d) => all.filter((m) => m.method.decides === d));
  const readBy = all.filter((m) => m.method.needs.decisions.includes(method.decides));
  const link = (m: MethodBox) => (
    <button key={m.method.id} type="button" className="mth-order-link" onClick={() => onPick(m.method.id)}>
      {m.order}. {m.method.name}
    </button>
  );
  return (
    <section className="mth-detail compact" aria-label={method.name}>
      <header className="mth-detail-head">
        <span className="mth-eyebrow">
          {order} · {method.decides}
        </span>
        <h2>{method.name}</h2>
        <p>{method.question}</p>
      </header>
      <section>
        <h3 className="dsx-h">Triggered by</h3>
        {starts.length > 0 ? (
          <ul className="mth-order-starts" aria-label={`What starts ${method.name}`}>
            {starts.map((m) => (
              <li key={m.kind}>
                <code>{m.kind}</code>, measured by {m.by.length > 0 ? m.by.join(" or ") : "no registered step"}
              </li>
            ))}
          </ul>
        ) : (
          <p>No measurement: it decides from the decisions it waits for.</p>
        )}
        {asks.length > 0 && <p>It also reads {asks.join(", ")}.</p>}
      </section>
      <section>
        <h3 className="dsx-h">Waits for</h3>
        <p className="mth-order-links">{waits.length > 0 ? waits.map(link) : "Nothing: it can decide first."}</p>
      </section>
      <section>
        <h3 className="dsx-h">Choices</h3>
        <ol className="mth-order-choices" aria-label={`Choices of ${method.name}`}>
          {method.options.map((option) => (
            <li key={option.id}>
              <span className="mth-order-if">
                <b>If</b> {option.when}
              </span>
              <strong>{option.label}</strong>
              <span className="mth-order-does">→ {effect(option)}</span>
              <span className="mth-order-why">{option.rationale}</span>
            </li>
          ))}
        </ol>
      </section>
      {readBy.length > 0 && (
        <section>
          <h3 className="dsx-h">Read next by</h3>
          <p className="mth-order-links">{readBy.map(link)}</p>
        </section>
      )}
      <section>
        <h3 className="dsx-h">Pitfall</h3>
        <p>{method.pitfall}</p>
      </section>
    </section>
  );
}

function StageCard({ data }: NodeProps<StageNode>) {
  return (
    <div className="mth-order-stage">
      <span className="mth-order-stage-title">{data.box.title}</span>
    </div>
  );
}

/** Lines meet the circle, not the name beside it; the circle is centred in the node's height. */
const INSET = (NODE.height - NODE.circle) / 2;
const IN = { left: NODE.circle / 2, top: INSET };
const OUT = { left: NODE.circle / 2, bottom: INSET };

function MethodCircle({ data, selected }: NodeProps<MethodNode>) {
  const { method, order } = data.box;
  return (
    // nopan: a click on a method picks it; it never starts a pan of the map.
    <button type="button" className="mth-order-node nopan" aria-pressed={selected} aria-label={method.name} title={method.question}>
      <Handle type="target" position={Position.Top} isConnectable={false} style={IN} />
      <span className="mth-order-circle" style={{ width: NODE.circle, height: NODE.circle }}>
        {order}
      </span>
      <span className="mth-order-label">
        <span className="mth-order-name">{method.name}</span>
        <span className="mth-order-key">{method.decides}</span>
      </span>
      <Handle type="source" position={Position.Bottom} isConnectable={false} style={OUT} />
    </button>
  );
}

function MeasureSquare({ data }: NodeProps<MeasureNode>) {
  const { kind, by } = data.box;
  return (
    <div className="mth-order-measure" title={`${kind}, measured by ${by.join(" or ") || "no registered step"}`}>
      <span className="mth-order-square" style={{ width: MEASURE.square, height: MEASURE.square }} />
      <span className="mth-order-label">
        <span className="mth-order-measure-by">{by[0] ?? "Not measured"}</span>
        <span className="mth-order-key">{kind}</span>
      </span>
      <Handle type="source" position={Position.Bottom} isConnectable={false} style={{ left: MEASURE.square / 2 }} />
    </div>
  );
}

const NODE_TYPES = { stage: StageCard, method: MethodCircle, measure: MeasureSquare };
