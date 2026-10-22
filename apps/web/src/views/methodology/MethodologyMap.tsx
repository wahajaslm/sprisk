import "@xyflow/react/dist/style.css";

import { Background, BackgroundVariant, Handle, type NodeProps, Position, ReactFlow } from "@xyflow/react";
import type { MethodologyReviewItem, MethodologyRule } from "@sprisk/contracts";
import { useMemo } from "react";

import { activation, ROUTE_LINE, ruleTree, stageName, type TreeNode } from "./ruleTree.ts";

type Props = {
  rules: MethodologyRule[];
  reviews: Map<string, MethodologyReviewItem>;
  path: boolean;
  picked: string | undefined;
  onPick: (ruleId: string) => void;
};

/** The methodology as one connected tree (ADR-0059), every possibility: stages and decisions in
 * decision order, each decision fanning out into its routes, each route leading on to the next
 * step. With a flow selected, each decision shows its status; with `path`, the flow's path is
 * one lit line and the rest dimmed. */
export function MethodologyMap({ rules, reviews, path, picked, onPick }: Props) {
  const tree = useMemo(() => ruleTree(rules, reviews, { path }), [rules, reviews, path]);
  const nodes = tree.nodes.map((n) => (n.type === "rule" ? { ...n, selected: n.id === picked } : n));
  // Lit lines mean the flow's path only; picking a decision highlights just that node.
  const edges = tree.edges.map((e) => ({ ...e, type: "default", className: `mth-edge ${e.data?.kind ?? "trunk"}${e.data?.onPath ? " path" : ""}` }));
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
        // Open on the shared start and the first lane, which runs above the shared line, at a
        // readable size: the whole tree fitted would be too small.
        fitView
        fitViewOptions={{ nodes: tree.nodes.filter((n) => n.position.x < START_WIDTH && n.position.y <= 0).map((n) => ({ id: n.id })), maxZoom: 1, padding: 0.08 }}
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
  reopen: "Reopen",
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

/** What each lane is for, as people read it. */
const LANE_NOTE: Record<string, string> = { supervised: "the question has a target", unsupervised: "the question has no target" };

function LaneNode({ data }: NodeProps<Extract<TreeNode, { type: "lane" }>>) {
  return (
    <div className={`mth-stage-node mth-lane${data.dimmed ? " dimmed" : ""}`}>
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <span className="mth-lane-mark" aria-hidden />
      <span className="mth-stage-text">
        <h2>{data.lane[0]!.toUpperCase() + data.lane.slice(1)}</h2>
        <span>{LANE_NOTE[data.lane] ?? `the ${data.lane} pack`}</span>
      </span>
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  );
}

function StageNode({ data }: NodeProps<Extract<TreeNode, { type: "stage" }>>) {
  return (
    <div className={`mth-stage-node${data.dimmed ? " dimmed" : ""}`}>
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <span className="mth-stage-ring">{data.code}</span>
      <span className="mth-stage-text">
        <h2>{stageName(data.stage)}</h2>
        <span>{data.count === 0 ? "no rules yet" : data.count === 1 ? "1 decision" : `${data.count} decisions`}</span>
      </span>
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  );
}

function RuleNode({ data, selected }: NodeProps<Extract<TreeNode, { type: "rule" }>>) {
  const { rule, review } = data;
  return (
    // nopan: a click on a rule picks it; it never starts a pan of the map.
    <button type="button" className={`mth-rule-node nopan ${review?.status ?? ""}${rule.status === "draft" ? " draft" : ""}${data.dimmed ? " dimmed" : ""}`} aria-pressed={selected} aria-label={rule.name}>
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <span className="mth-rule-dot" />
      <span className="mth-rule-text">
        <span className="mth-rule-name">
          <span className="mth-node-code">{data.code}</span> {rule.name}
        </span>
        <span className="mth-rule-meta" title={rule.decides}>
          {activation(rule) ?? rule.decides}
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
  const { route, when, code, picked, dimmed } = data;
  return (
    <div className={`mth-route-node${picked ? " picked" : ""}${dimmed ? " dimmed" : ""}`} title={`${route.description}${when ? `\nWhen ${when}` : ""}\nWhy: ${route.rationale}`}>
      <Handle type="target" position={Position.Left} isConnectable={false} style={{ top: ROUTE_LINE }} />
      <span className="mth-route-dot" />
      <span className="mth-rule-text">
        <span className="mth-route-name">
          <span className="mth-node-code">{code}</span> {route.label}
        </span>
        {when ? <span className="mth-when">When {when}</span> : <span className="mth-rule-meta">{route.action.operator?.split("@")[0] ?? route.description}</span>}
      </span>
      <Handle type="source" position={Position.Right} isConnectable={false} style={{ top: ROUTE_LINE }} />
    </div>
  );
}

/** How much of the tree, from the left, the canvas fits on opening. */
const START_WIDTH = 1150;

const NODE_TYPES = { root: RootNode, lane: LaneNode, stage: StageNode, rule: RuleNode, route: RouteNode };
