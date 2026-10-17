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
  // One layout for steps inside stages too, placed as if each connection went around steps.
  "elk.hierarchyHandling": "INCLUDE_CHILDREN",
  "elk.edgeRouting": "ORTHOGONAL",
  // Leave room between steps for their connections.
  "elk.layered.mergeEdges": "true",
  "elk.spacing.edgeEdge": "14",
  "elk.layered.spacing.edgeEdgeBetweenLayers": "14",
  "elk.layered.spacing.edgeNodeBetweenLayers": "24",
};

/** The canvas id of a connection, the same in the layout and on the canvas. */
export const edgeId = (e: { from: string; to: string }) => `${e.from}->${e.to}`;

/** Where each step sits: stages left to right by what they read, a stage's steps together under
 * its heading, rows kept straight and crossings low (ELK's layered layout, which places steps as
 * if routing their connections). View state only; never saved with the flow. */
export async function flowPositions(
  pipeline: PipelineVersion,
  sizeOf: (nodeId: string) => Size,
  groupOf: (nodeId: string) => string | undefined,
): Promise<{ nodes: Map<string, Point>; groups: Group[] }> {
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
        // Room between a stage's steps, so the curve joining them is a gentle bend, not a hook.
        layoutOptions: { "elk.padding": `[top=${GROUP_HEAD},left=0,bottom=0,right=0]`, "elk.layered.spacing.nodeNodeBetweenLayers": "64" },
        children: ids.map((id) => ({ id, ...sizeOf(id) })),
      })),
    ],
    edges: pipeline.edges.map((e) => ({ id: edgeId(e), sources: [stepOf(e.from)], targets: [stepOf(e.to)] })),
  };
  const out = await elk.layout(graph);

  const nodes = new Map<string, Point>();
  const groups: Group[] = [];
  for (const child of out.children ?? []) {
    const x = child.x ?? 0;
    const y = child.y ?? 0;
    if (!child.id.startsWith("group:")) {
      nodes.set(child.id, { x, y });
      continue;
    }
    const steps = child.children ?? [];
    for (const n of steps) nodes.set(n.id, { x: x + (n.x ?? 0), y: y + (n.y ?? 0) });
    groups.push({ id: child.id.slice("group:".length), count: steps.length, x, y, width: child.width ?? 0, height: child.height ?? 0 });
  }
  return { nodes, groups };
}

/** Steps at the layout's places, except steps the person dragged, which stay where they were
 * dropped. With nothing dragged (Tidy), every step is where the layout puts it. */
export function keepDragged<T extends { id: string; position: Point }>(computed: T[], shown: T[], dragged: ReadonlySet<string>): T[] {
  const at = new Map(shown.map((n) => [n.id, n.position]));
  return computed.map((n) => ({ ...n, position: dragged.has(n.id) ? (at.get(n.id) ?? n.position) : n.position }));
}
