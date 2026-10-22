import "@xyflow/react/dist/style.css";

import { Background, BackgroundVariant, Handle, type NodeProps, Position, ReactFlow } from "@xyflow/react";
import type { MethodologyReviewItem, MethodologyRule } from "@sprisk/contracts";
import { useEffect, useMemo, useState } from "react";

import { Loading } from "../../components/ui/Loading.tsx";
import { type DecisionTree, type DecisionTreeNode, decisionTree, layoutDecisionTree } from "../../flow/decisionTree.ts";
import { stageName } from "./ruleTree.ts";

type Props = {
  rules: MethodologyRule[];
  reviews: Map<string, MethodologyReviewItem>;
  drafts: boolean;
  picked: string | undefined;
  onPick: (ruleId: string) => void;
};

/** The methodology as a node-based decision tree (ADR-0059): each decision branches into its
 * routes, each route showing its condition, and every route leads on to the next decision. With a flow selected, the route its review recommends is lit. */
export function MethodologyMap({ rules, reviews, drafts, picked, onPick }: Props) {
  const tree = useMemo(() => decisionTree(rules, reviews, { drafts }), [rules, reviews, drafts]);
  const laid = useLayout(tree);
  if (laid === undefined) return <Loading text="Laying out the map…" pad />;
  if (typeof laid === "string") return <p role="alert" className="error pad">{laid}</p>;

  const lit = new Set(laid.nodes.filter((n) => n.type === "route" && n.data.picked).map((n) => n.id));
  const nodes = laid.nodes.map((n) => (n.type === "decision" ? { ...n, selected: n.id === picked } : n));
  const edges = laid.edges.map((e) => ({
    ...e,
    type: "smoothstep",
    className: `mth-edge${lit.has(e.target) || lit.has(e.source) ? " picked" : ""}`,
  }));
  return (
    <div className="mth-map" role="region" aria-label="Methodology map">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        onNodeClick={(_event, node) => {
          if (node.type === "decision") onPick(node.id);
          if (node.type === "route") onPick(node.id.split("#")[0]!);
        }}
        // Readable size from the left: the whole tree fitted to the window would be too small to read.
        defaultViewport={{ x: 24, y: 64, zoom: 0.8 }}
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

/** The laid-out tree, an error message, or `undefined` while ELK works. */
function useLayout(tree: DecisionTree): DecisionTree | string | undefined {
  const [result, setResult] = useState<{ tree: DecisionTree; laid: DecisionTree | string }>();
  useEffect(() => {
    let live = true;
    layoutDecisionTree(tree).then(
      (laid) => live && setResult({ tree, laid }),
      (e: unknown) => live && setResult({ tree, laid: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      live = false;
    };
  }, [tree]);
  return result?.tree === tree ? result.laid : undefined;
}

/** Plain names for review statuses, as people read them. */
export const STATUS_LABEL: Record<MethodologyReviewItem["status"], string> = {
  settled: "Settled",
  proposal: "Proposal",
  needs_fact: "Needs a fact",
  needs_run: "Needs a run",
  waiting: "Waiting",
  no_subject: "No step yet",
  not_applicable: "Not applicable",
};

function StageBox({ data }: NodeProps<Extract<DecisionTreeNode, { type: "stage" }>>) {
  return (
    <div className="mth-stage-box">
      <header className="mth-stage-head">
        <h2>{stageName(data.stage)}</h2>
        <span className="muted">{data.count === 1 ? "1 decision" : `${data.count} decisions`}</span>
      </header>
    </div>
  );
}

function DecisionNode({ data, selected }: NodeProps<Extract<DecisionTreeNode, { type: "decision" }>>) {
  const { rule, review } = data;
  return (
    <button type="button" className="mth-decision" aria-pressed={selected} aria-label={rule.name}>
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <span className="mth-diamond" aria-hidden />
      <span className="mth-decision-head">
        <span className="mth-decision-name">{rule.name}</span>
        <span className="mth-decision-meta">
          <code>{rule.decides}</code>
          {rule.status === "draft" && <span className="mth-chip draft">Draft</span>}
          {review && (
            <span className={`mth-chip ${review.status}`} title={review.reason}>
              {STATUS_LABEL[review.status]}
            </span>
          )}
        </span>
      </span>
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </button>
  );
}

function RouteNode({ data }: NodeProps<Extract<DecisionTreeNode, { type: "route" }>>) {
  const { route, picked, dimmed } = data;
  return (
    <div className={`mth-route${picked ? " picked" : ""}${dimmed ? " dimmed" : ""}`} title={`${route.description}\nWhy: ${route.rationale}`}>
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <span className="mth-route-name">{route.label}</span>
      <span className="mth-route-when">{route.condition ? `When ${route.condition}` : route.description}</span>
      {route.action.operator && <code className="mth-route-step">{route.action.operator.split("@")[0]}</code>}
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  );
}

const NODE_TYPES = { stage: StageBox, decision: DecisionNode, route: RouteNode };
