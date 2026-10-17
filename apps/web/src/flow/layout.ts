import type { PipelineVersion } from "@sprisk/contracts";
import ELK, { type ElkNode } from "elkjs/lib/elk.bundled.js";
import { stepOf } from "./ports.ts";

const elk = new ELK();

export type Size = { width: number; height: number };
export type Point = { x: number; y: number };
/** A stage's steps, kept together under one heading. */
export type Group = { id: string; count: number } & Point & Size;

/** Room above a group's steps for its heading. */
export const GROUP_HEAD = 44;

const LAYERED = {
  "elk.algorithm": "layered",
  "elk.direction": "RIGHT",
  "elk.layered.spacing.nodeNodeBetweenLayers": "90",
  "elk.spacing.nodeNode": "28",
  "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
  // One layout for steps inside stages too, so every connection is routed around steps.
  "elk.hierarchyHandling": "INCLUDE_CHILDREN",
  "elk.edgeRouting": "ORTHOGONAL",
  // Lines leaving one step share a trunk, and parallel lines keep apart, so they can be told apart.
  "elk.layered.mergeEdges": "true",
  "elk.spacing.edgeEdge": "14",
  "elk.layered.spacing.edgeEdgeBetweenLayers": "14",
  "elk.layered.spacing.edgeNodeBetweenLayers": "24",
};

/** The canvas id of a connection, the same in the layout and on the canvas. */
export const edgeId = (e: { from: string; to: string }) => `${e.from}->${e.to}`;

/** Where each step sits and how each connection runs: stages left to right by what they read,
 * a stage's steps together under its heading, connections in straight segments with right-angle
 * bends that go around steps (ELK's layered layout). View state only; never saved with the flow. */
export async function flowPositions(
  pipeline: PipelineVersion,
  sizeOf: (nodeId: string) => Size,
  groupOf: (nodeId: string) => string | undefined,
): Promise<{ nodes: Map<string, Point>; groups: Group[]; routes: Map<string, Point[]> }> {
  const members = new Map<string, string[]>();
  const alone: string[] = [];
  for (const n of pipeline.nodes) {
    const name = groupOf(n.id);
    if (name === undefined) alone.push(n.id);
    else members.set(name, [...(members.get(name) ?? []), n.id]);
  }
  const graph: ElkNode = {
    id: "flow",
    layoutOptions: LAYERED,
    children: [
      ...alone.map((id) => ({ id, ...sizeOf(id) })),
      ...[...members].map(([name, ids]) => ({
        id: `group:${name}`,
        layoutOptions: { "elk.padding": `[top=${GROUP_HEAD},left=0,bottom=0,right=0]` },
        children: ids.map((id) => ({ id, ...sizeOf(id) })),
      })),
    ],
    edges: pipeline.edges.map((e) => ({ id: edgeId(e), sources: [stepOf(e.from)], targets: [stepOf(e.to)] })),
  };
  const out = await elk.layout(graph);

  const nodes = new Map<string, Point>();
  const groups: Group[] = [];
  // A route's points are relative to the box that holds it (the flow, or a stage).
  const offset = new Map<string, Point>([["flow", { x: 0, y: 0 }]]);
  for (const child of out.children ?? []) {
    const x = child.x ?? 0;
    const y = child.y ?? 0;
    if (!child.id.startsWith("group:")) {
      nodes.set(child.id, { x, y });
      continue;
    }
    offset.set(child.id, { x, y });
    const steps = child.children ?? [];
    for (const n of steps) nodes.set(n.id, { x: x + (n.x ?? 0), y: y + (n.y ?? 0) });
    groups.push({ id: child.id.slice("group:".length), count: steps.length, x, y, width: child.width ?? 0, height: child.height ?? 0 });
  }
  const routes = new Map<string, Point[]>();
  for (const edge of out.edges ?? []) {
    const at = offset.get((edge as { container?: string }).container ?? "flow") ?? { x: 0, y: 0 };
    const points = (edge.sections ?? []).flatMap((s) => [s.startPoint, ...(s.bendPoints ?? []), s.endPoint]);
    routes.set(edge.id, points.map((p) => ({ x: p.x + at.x, y: p.y + at.y })));
  }
  return { nodes, groups, routes };
}

/** Steps at the layout's places, except steps the person dragged, which stay where they were
 * dropped. With nothing dragged (Tidy), every step is where the layout puts it. */
export function keepDragged<T extends { id: string; position: Point }>(computed: T[], shown: T[], dragged: ReadonlySet<string>): T[] {
  const at = new Map(shown.map((n) => [n.id, n.position]));
  return computed.map((n) => ({ ...n, position: dragged.has(n.id) ? (at.get(n.id) ?? n.position) : n.position }));
}

/** An SVG path along a route: straight segments, square corners like the rest of Studio. */
export const routePath = (route: Point[]) => route.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
