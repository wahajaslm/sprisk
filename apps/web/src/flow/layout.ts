import type { PipelineVersion } from "@sprisk/contracts";
import ELK, { type ElkNode } from "elkjs/lib/elk.bundled.js";

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
};

/** Where each step sits on the canvas: left to right by what it reads, crossings kept low
 * (ELK's layered layout). Steps of one stage stay together inside its group. View state only;
 * never saved with the flow. */
export async function flowPositions(
  pipeline: PipelineVersion,
  sizeOf: (nodeId: string) => Size,
  groupOf: (nodeId: string) => string | undefined,
): Promise<{ nodes: Map<string, Point>; groups: Group[] }> {
  const groups = new Map<string, ElkNode>();
  const top: ElkNode[] = [];
  for (const n of pipeline.nodes) {
    const child = { id: n.id, ...sizeOf(n.id) };
    const name = groupOf(n.id);
    if (name === undefined) {
      top.push(child);
      continue;
    }
    let group = groups.get(name);
    if (!group) {
      group = {
        id: `group:${name}`,
        layoutOptions: { ...LAYERED, "elk.padding": `[top=${GROUP_HEAD},left=0,bottom=0,right=0]` },
        children: [],
      };
      groups.set(name, group);
      top.push(group);
    }
    group.children?.push(child);
  }
  const graph = await elk.layout({
    id: "flow",
    layoutOptions: { ...LAYERED, "elk.hierarchyHandling": "INCLUDE_CHILDREN" },
    children: top,
    edges: pipeline.edges.map((e, i) => ({
      id: `e${i}`,
      sources: [e.from.split(".")[0] ?? e.from],
      targets: [e.to.split(".")[0] ?? e.to],
    })),
  });

  const nodes = new Map<string, Point>();
  const boxes: Group[] = [];
  for (const child of graph.children ?? []) {
    const x = child.x ?? 0;
    const y = child.y ?? 0;
    if (!child.id.startsWith("group:")) {
      nodes.set(child.id, { x, y });
      continue;
    }
    const inner = child.children ?? [];
    for (const n of inner) nodes.set(n.id, { x: x + (n.x ?? 0), y: y + (n.y ?? 0) });
    boxes.push({ id: child.id.slice("group:".length), count: inner.length, x, y, width: child.width ?? 0, height: child.height ?? 0 });
  }
  return { nodes, groups: boxes };
}
