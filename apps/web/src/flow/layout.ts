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
};

/** Where each step sits on the canvas: stages left to right by what they read, crossings kept
 * low (ELK's layered layout). A stage's steps stack top to bottom inside its group. View state
 * only; never saved with the flow. */
export async function flowPositions(
  pipeline: PipelineVersion,
  sizeOf: (nodeId: string) => Size,
  groupOf: (nodeId: string) => string | undefined,
): Promise<{ nodes: Map<string, Point>; groups: Group[] }> {
  const links = pipeline.edges.map((e) => ({ from: stepOf(e.from), to: stepOf(e.to) }));

  const members = new Map<string, string[]>();
  for (const n of pipeline.nodes) {
    const name = groupOf(n.id);
    if (name !== undefined) members.set(name, [...(members.get(name) ?? []), n.id]);
  }

  // Each stage first, on its own, so its steps stack downward; it then takes part in the
  // canvas layout as one box of that size.
  const inner = new Map<string, ElkNode>();
  for (const [name, ids] of members) {
    const inside = new Set(ids);
    inner.set(
      name,
      await elk.layout({
        id: `group:${name}`,
        layoutOptions: { ...LAYERED, "elk.direction": "DOWN", "elk.layered.spacing.nodeNodeBetweenLayers": "28", "elk.padding": "[top=0,left=0,bottom=0,right=0]" },
        children: ids.map((id) => ({ id, ...sizeOf(id) })),
        edges: links
          .filter((l) => inside.has(l.from) && inside.has(l.to))
          .map((l, i) => ({ id: `e${i}`, sources: [l.from], targets: [l.to] })),
      }),
    );
  }

  const box = (id: string) => {
    const name = groupOf(id);
    return name === undefined ? id : `group:${name}`;
  };
  const seen = new Set<string>();
  const outer = await elk.layout({
    id: "flow",
    layoutOptions: LAYERED,
    children: [
      ...pipeline.nodes.filter((n) => groupOf(n.id) === undefined).map((n) => ({ id: n.id, ...sizeOf(n.id) })),
      ...[...inner].map(([name, g]) => ({ id: `group:${name}`, width: g.width ?? 0, height: (g.height ?? 0) + GROUP_HEAD })),
    ],
    edges: links.flatMap((l, i) => {
      const [from, to] = [box(l.from), box(l.to)];
      const key = `${from}>${to}`;
      if (from === to || seen.has(key)) return [];
      seen.add(key);
      return [{ id: `e${i}`, sources: [from], targets: [to] }];
    }),
  });

  const nodes = new Map<string, Point>();
  const groups: Group[] = [];
  for (const child of outer.children ?? []) {
    const x = child.x ?? 0;
    const y = child.y ?? 0;
    if (!child.id.startsWith("group:")) {
      nodes.set(child.id, { x, y });
      continue;
    }
    const steps = inner.get(child.id.slice("group:".length))?.children ?? [];
    for (const n of steps) nodes.set(n.id, { x: x + (n.x ?? 0), y: y + GROUP_HEAD + (n.y ?? 0) });
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
