import "@xyflow/react/dist/style.css";

import { Background, BackgroundVariant, Handle, type NodeProps, Position, ReactFlow } from "@xyflow/react";
import type { MethodologyRule } from "@sprisk/contracts";
import { useMemo } from "react";

import { ruleTree, stageName, type TreeNode } from "./ruleTree.ts";

type Props = { rules: MethodologyRule[]; picked: string | undefined; onPick: (ruleId: string) => void };

/** The rule packs as a tree: methodology, its stages in order, and each stage's rules. */
export function MethodologyMap({ rules, picked, onPick }: Props) {
  const tree = useMemo(() => ruleTree(rules), [rules]);
  const nodes = tree.nodes.map((n) => (n.type === "rule" ? { ...n, selected: n.id === picked } : n));
  const branch = rules.find((r) => r.id === picked)?.stage;
  const edges = tree.edges.map((e) => {
    const lit = e.target === picked || e.target === `stage:${branch}`;
    return { ...e, type: "default", className: `mth-edge ${e.source === "root" ? "trunk" : "twig"}${lit ? " picked" : ""}` };
  });
  return (
    <div className="mth-map" role="region" aria-label="Methodology map">
      <ReactFlow
        key={rules.length}
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        onNodeClick={(_event, node) => node.type === "rule" && onPick(node.id)}
        // Full size from the top: 30 rules fitted to the window would be too small to read.
        defaultViewport={{ x: 24, y: 64, zoom: 1 }}
        panOnScroll
        nodesDraggable={false}
        nodesConnectable={false}
        minZoom={0.3}
        maxZoom={1.5}
        proOptions={{ hideAttribution: true }}
        colorMode="dark"
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="rgba(255,255,255,0.12)" />
      </ReactFlow>
    </div>
  );
}

function RootNode({ data }: NodeProps<Extract<TreeNode, { type: "root" }>>) {
  return (
    <div className="mth-root" title="Methodology rules">
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
    <div className="mth-stage-node">
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <span className="mth-stage-ring">{data.number}</span>
      <span className="mth-stage-text">
        <h2>{stageName(data.stage)}</h2>
        <span>{data.count === 1 ? "1 rule" : `${data.count} rules`}</span>
      </span>
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  );
}

function RuleNode({ data, selected }: NodeProps<Extract<TreeNode, { type: "rule" }>>) {
  return (
    // nopan: a click on a rule picks it; it never starts a pan of the map.
    <button type="button" className="mth-rule-node nopan" aria-pressed={selected}>
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <span className="mth-rule-dot" />
      <span className="mth-rule-text">
        <span className="mth-rule-name">{data.rule.name}</span>
        <span className="mth-rule-meta">{data.rule.decides}</span>
      </span>
    </button>
  );
}

const NODE_TYPES = { root: RootNode, stage: StageNode, rule: RuleNode };
