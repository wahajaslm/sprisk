import type { PipelineVersion } from "@sprisk/contracts";
import ELK from "elkjs/lib/elk.bundled.js";
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
  // Compact, so a whole flow fits the panel at a readable size.
  "elk.layered.spacing.nodeNodeBetweenLayers": "64",
  "elk.spacing.nodeNode": "24",
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

  // Each stage first: its steps in one column. It then takes part in the canvas layout as one
  // box of that size.
  const inner = new Map(
    [...members].map(([name, ids]) => [name, column(ids, links, sizeOf)] as const),
  );

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
      ...[...inner].map(([name, g]) => ({ id: `group:${name}`, width: g.width, height: g.height + GROUP_HEAD })),
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
    const steps = inner.get(child.id.slice("group:".length))?.at ?? new Map<string, Point>();
    for (const [id, p] of steps) nodes.set(id, { x: x + p.x, y: y + GROUP_HEAD + p.y });
    groups.push({ id: child.id.slice("group:".length), count: steps.size, x, y, width: child.width ?? 0, height: child.height ?? 0 });
  }
  return { nodes, groups };
}

/** Steps at the layout's places, except steps the person dragged, which stay where they were
 * dropped. With nothing dragged (Tidy), every step is where the layout puts it. */
export function keepDragged<T extends { id: string; position: Point }>(computed: T[], shown: T[], dragged: ReadonlySet<string>): T[] {
  const at = new Map(shown.map((n) => [n.id, n.position]));
  return computed.map((n) => ({ ...n, position: dragged.has(n.id) ? (at.get(n.id) ?? n.position) : n.position }));
}

const STAGE_GAP = 24;

/** A stage's steps in one column: each below the steps it reads, otherwise in flow order.
 * Compact and predictable, whatever the steps' size. */
function column(ids: string[], links: { from: string; to: string }[], sizeOf: (nodeId: string) => Size) {
  const inside = new Set(ids);
  const before = new Map(ids.map((id) => [id, new Set(links.filter((l) => l.to === id && inside.has(l.from)).map((l) => l.from))]));
  const order: string[] = [];
  while (order.length < ids.length) {
    // The first step (in flow order) whose readers-from are all placed; a cycle cannot happen
    // in a compiled flow, but fall back to flow order rather than loop.
    const next = ids.find((id) => !order.includes(id) && [...(before.get(id) ?? [])].every((b) => order.includes(b))) ?? ids.find((id) => !order.includes(id))!;
    order.push(next);
  }
  const at = new Map<string, Point>();
  let y = 0;
  let width = 0;
  for (const id of order) {
    const size = sizeOf(id);
    at.set(id, { x: 0, y });
    y += size.height + STAGE_GAP;
    width = Math.max(width, size.width);
  }
  return { at, width, height: Math.max(0, y - STAGE_GAP) };
}
