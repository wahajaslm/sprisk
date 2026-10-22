import "@xyflow/react/dist/style.css";

import { Background, BackgroundVariant, Handle, type NodeProps, Position, ReactFlow } from "@xyflow/react";
import type { MethodologyReviewItem, MethodologyRule } from "@sprisk/contracts";
import { useMemo } from "react";

import { ruleTree, stageName, type TreeNode } from "./ruleTree.ts";

type Props = {
  rules: MethodologyRule[];
  reviews: Map<string, MethodologyReviewItem>;
  path: boolean;
  picked: string | undefined;
  onPick: (ruleId: string) => void;
};

/** The methodology as a tree (ADR-0059): every possibility, from its stages in decision order
 * to each decision's routes with the condition that leads to them. With a flow selected, each
 * decision shows its status there; with `path`, the flow's path is lit and the rest dimmed. */
export function MethodologyMap({ rules, reviews, path, picked, onPick }: Props) {
  const tree = useMemo(() => ruleTree(rules, reviews, { path }), [rules, reviews, path]);
  const branch = rules.find((r) => r.id === picked)?.stage;
  const nodes = tree.nodes.map((n) => (n.type === "rule" ? { ...n, selected: n.id === picked } : n));
  const edges = tree.edges.map((e) => {
    const lit = e.target === picked || e.target === `stage:${branch}` || e.source === picked;
    const level = e.target.startsWith("stage:") ? "trunk" : e.source.startsWith("stage:") ? "twig" : "leaf";
    return { ...e, type: "default", className: `mth-edge ${level}${lit ? " picked" : ""}${e.data?.onPath ? " path" : ""}` };
  });
  return (
    <div className="mth-map" role="region" aria-label="Methodology map">
      <ReactFlow
        key={`${tree.nodes.length}`}
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        onNodeClick={(_event, node) => {
          if (node.type === "rule") onPick(node.id);
          if (node.type === "route") onPick(node.id.split("#")[0]!);
        }}
        // Full size from the top: the whole tree fitted to the window would be too small to read.
        defaultViewport={{ x: 24, y: 96, zoom: 0.9 }}
        panOnScroll
        nodesDraggable={false}
        nodesConnectable={false}
        minZoom={0.2}
        maxZoom={1.5}
        proOptions={{ hideAttribution: true }}
        colorMode="dark"
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="rgba(255,255,255,0.12)" />
      </ReactFlow>
    </div>
  );
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

function RootNode({ data }: NodeProps<Extract<TreeNode, { type: "root" }>>) {
  return (
    <div className="mth-root" title="Methodology decisions">
      <span className="mth-root-ring">
        <strong>Rules</strong>
        <span>{data.count}</span>
      </span>
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  );
}

function StageNode({ data }: NodeProps<Extract<TreeNode, { type: "stage" }>>) {
  return (
    <div className={`mth-stage-node${data.dimmed ? " dimmed" : ""}`}>
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <span className="mth-stage-ring">{data.number}</span>
      <span className="mth-stage-text">
        <h2>{stageName(data.stage)}</h2>
        <span>{data.count === 0 ? "no rules yet" : data.count === 1 ? "1 decision" : `${data.count} decisions`}</span>
      </span>
      {/* The trunk runs on to the next stage; the branches hang down to this stage's decisions. */}
      <Handle type="source" position={Position.Right} isConnectable={false} />
      <Handle id="branch" type="source" position={Position.Bottom} isConnectable={false} style={{ left: 13 }} />
    </div>
  );
}

function RuleNode({ data, selected }: NodeProps<Extract<TreeNode, { type: "rule" }>>) {
  const { rule, review } = data;
  return (
    <button type="button" className={`mth-rule-node ${review?.status ?? ""}${rule.status === "draft" ? " draft" : ""}${data.dimmed ? " dimmed" : ""}`} aria-pressed={selected} aria-label={rule.name}>
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <span className="mth-rule-dot" />
      <span className="mth-rule-text">
        <span className="mth-rule-name">{rule.name}</span>
        <span className="mth-rule-meta">
          {rule.decides}
          {rule.status === "draft" && " · draft"}
          {review && (
            <span className={`mth-rule-status ${review.status}`} title={review.reason}>
              {" · "}
              {STATUS_LABEL[review.status]}
            </span>
          )}
        </span>
      </span>
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </button>
  );
}

function RouteNode({ data }: NodeProps<Extract<TreeNode, { type: "route" }>>) {
  const { route, picked, dimmed } = data;
  return (
    <div className={`mth-route-node${picked ? " picked" : ""}${dimmed ? " dimmed" : ""}`} title={`${route.description}\nWhy: ${route.rationale}`}>
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <span className="mth-route-dot" />
      <span className="mth-rule-text">
        <span className="mth-route-name">{route.label}</span>
        <span className="mth-rule-meta">{route.condition ? `When ${route.condition}` : (route.action.operator?.split("@")[0] ?? route.description)}</span>
      </span>
    </div>
  );
}

const NODE_TYPES = { root: RootNode, stage: StageNode, rule: RuleNode, route: RouteNode };
