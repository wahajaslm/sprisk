import "@xyflow/react/dist/style.css";

import { Background, BackgroundVariant, Controls, type Edge, Handle, MarkerType, type Node, type NodeProps, Position, ReactFlow } from "@xyflow/react";
import type { Method, Operator } from "@sprisk/contracts";
import { useMemo, useRef } from "react";

import { FLOW, type FlowNode, decisionFlow } from "./decisionFlow.ts";
import { effect, numbered, type OrderedMethod } from "./decisionOrder.ts";

/** `readers`: the numbers of the later decisions that read a choice's decision. */
type Data<K extends FlowNode["kind"]> = Node<{ node: Extract<FlowNode, { kind: K }>; readers: string[] }, K>;

const MIN_OPEN_ZOOM = 0.8;

/** Where the decisions lead once all are made: the steps still decided by old-format rules. */
const END = "Model comparison";

/** The decisions as a flowchart, top to bottom: a diamond per decision, a circle per choice
 * with when it is taken, and every choice leading on to the next decision. The picked
 * decision's details are in a column beside the canvas, never over it. */
export function DecisionOrderMap({ methods, operators, picked, onPick }: { methods: Method[]; operators: Operator[]; picked: string | undefined; onPick: (id: string) => void }) {
  const flow = useMemo(() => decisionFlow(methods, END), [methods]);
  const box = useRef<HTMLDivElement>(null);
  const ordered = useMemo(() => numbered(methods), [methods]);
  const current = ordered.find((m) => m.method.id === picked) ?? ordered[0];
  const readersOf = (method: Method) => ordered.filter((m) => m.method.needs.decisions.includes(method.decides));
  const nodes = flow.nodes.map((node): Node => {
    const size = node.kind === "choice" ? { width: FLOW.choice.width, height: FLOW.choice.height } : node.kind === "stage" ? { width: node.width, height: node.height } : { width: FLOW.diamond, height: FLOW.diamond };
    const selected = node.kind === "decision" && node.ordered.method.id === current?.method.id;
    // A stage box sits behind the decisions and lines it holds.
    return { id: node.id, type: node.kind, position: { x: node.x, y: node.y }, ...size, data: { node, readers: node.kind === "choice" ? readersOf(node.method).map((m) => String(m.order)) : [] }, selected, selectable: node.kind === "decision" || node.kind === "choice", ...(node.kind === "stage" ? { zIndex: -1 } : {}) };
  });
  const edges: Edge[] = flow.links.map((l) => ({ id: l.id, source: l.from, target: l.to, type: "default", markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12 }, className: "mth-order-edge" }));
  return (
    <div className="mth-order-wrap">
      <div ref={box} className="mth-map mth-order" role="region" aria-label="Decision order">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          onNodeClick={(_event, node) => {
            const n = (node.data as { node: FlowNode }).node;
            if (n.kind === "decision") onPick(n.ordered.method.id);
            if (n.kind === "choice") onPick(n.method.id);
          }}
          // Open on the top left of the first stage, as wide as the canvas allows but never below
          // 80%: text drawn much smaller blurs. The rest is a pan or scroll away.
          onInit={(canvas) => {
            const zoom = Math.min(1, Math.max(MIN_OPEN_ZOOM, ((box.current?.clientWidth ?? 0) - 48) / flow.width));
            void canvas.setViewport({ x: 24 - flow.left * zoom, y: 24 + (FLOW.toNext / 2) * zoom, zoom });
          }}
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
        <aside className="mth-order-card">
          <MethodDetail key={current.method.id} current={current} all={ordered} operators={operators} onPick={onPick} />
        </aside>
      )}
    </div>
  );
}

/** The picked decision: its choices with when and why, what it is decided from, what it
 * waits for, and its pitfall. */
function MethodDetail({ current, all, operators, onPick }: { current: OrderedMethod; all: OrderedMethod[]; operators: Operator[]; onPick: (id: string) => void }) {
  const { method, order } = current;
  const waits = method.needs.decisions.flatMap((d) => all.filter((m) => m.method.decides === d));
  const readBy = all.filter((m) => m.method.needs.decisions.includes(method.decides));
  const measuredBy = (kind: string) => operators.filter((o) => o.produces?.[kind] !== undefined).map((o) => o.title ?? o.id);
  const link = (m: OrderedMethod) => (
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
        <h3 className="dsx-h">Choices</h3>
        <ol className="mth-order-choices" aria-label={`Choices of ${method.name}`}>
          {method.options.map((option) => (
            <li key={option.id}>
              <span className="mth-order-if">
                <b>If</b> {option.when}
              </span>
              <strong>{option.label}</strong>
              <span className="mth-order-does">→ {effect(option, readBy.map((m) => `${m.order}. ${m.method.name}`))}</span>
              <span className="mth-order-why">{option.rationale}</span>
            </li>
          ))}
        </ol>
      </section>
      <section>
        <h3 className="dsx-h">Decided from</h3>
        {method.needs.evidence.length > 0 ? (
          <ul className="mth-order-starts" aria-label={`What ${method.name} is decided from`}>
            {method.needs.evidence.map((kind) => (
              <li key={kind}>
                <code>{kind}</code>, measured by {measuredBy(kind).join(" or ") || "no registered step"}
              </li>
            ))}
          </ul>
        ) : (
          <p>No measurement: only the earlier decisions it waits for.</p>
        )}
      </section>
      <section>
        <h3 className="dsx-h">Waits for</h3>
        <p className="mth-order-links">{waits.length > 0 ? waits.map(link) : "Nothing: it can decide first."}</p>
      </section>
      {readBy.length > 0 && (
        <section>
          <h3 className="dsx-h">Read later by</h3>
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

function Ports() {
  return (
    <>
      <Handle type="target" position={Position.Top} isConnectable={false} />
      <Handle type="source" position={Position.Bottom} isConnectable={false} />
    </>
  );
}

function StageLabel({ data }: NodeProps<Data<"stage">>) {
  return (
    <div className="mth-order-stage">
      <span className="mth-order-stage-title">{data.node.title}</span>
    </div>
  );
}

function DecisionDiamond({ data, selected }: NodeProps<Data<"decision">>) {
  const { method, order } = data.node.ordered;
  return (
    // nopan: a click picks the decision; it never starts a pan of the map.
    <button type="button" className="mth-flow-node decision nopan" aria-pressed={selected} aria-label={method.name} title={method.pitfall}>
      <span className="mth-flow-diamond" />
      <span className="mth-flow-side">
        <span className="mth-flow-name">
          <span className="mth-node-code">{order}</span> {method.name}
        </span>
        <span className="mth-order-question">{method.question}</span>
      </span>
      <Ports />
    </button>
  );
}

function ChoiceCircle({ data }: NodeProps<Data<"choice">>) {
  const { option } = data.node;
  const does = effect(option, data.readers);
  return (
    <button type="button" className="mth-flow-node step mth-order-choice nopan" aria-label={option.label} title={`If ${option.when}: ${option.label}, ${does}`}>
      <span className="mth-flow-circle" style={{ width: FLOW.choice.circle, height: FLOW.choice.circle }} />
      <span className="mth-order-cond">{option.condition}</span>
      <span className="mth-flow-name">{option.label}</span>
      <span className="mth-order-does">{does}</span>
      <Ports />
    </button>
  );
}

function End({ data }: NodeProps<Data<"end">>) {
  return (
    <div className="mth-flow-node terminal">
      <span className="mth-flow-circle" />
      <span className="mth-flow-side">{data.node.label}, still decided by the old rules</span>
      <Handle type="target" position={Position.Top} isConnectable={false} />
    </div>
  );
}

const NODE_TYPES = { stage: StageLabel, decision: DecisionDiamond, choice: ChoiceCircle, end: End };
