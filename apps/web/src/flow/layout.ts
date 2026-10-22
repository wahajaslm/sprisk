import type { Node, PipelineVersion } from "@sprisk/contracts";
import ELK from "elkjs/lib/elk.bundled.js";
import { stepOf } from "./ports.ts";

const elk = new ELK();

export type Size = { width: number; height: number };
export type Point = { x: number; y: number };
/** A stage's steps, kept together under one heading. */
export type Group = { id: string; count: number } & Point & Size;

/** Room above a group's steps for its card header. */
export const STAGE_PAD_X = 20;
export const STAGE_HEAD_HEIGHT = 186;
export const STAGE_FOOTER_HEIGHT = 44;
export const MIN_STAGE_CARD_WIDTH = 340;
export const MIN_STAGE_CARD_HEIGHT = 520;
export const GROUP_HEAD = STAGE_HEAD_HEIGHT;

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
  sizeOf: (node: Node) => Size,
  groupOf: (nodeId: string) => string | undefined,
): Promise<{ nodes: Map<string, Point>; groups: Group[] }> {
  const links = pipeline.edges.map((e) => ({ from: stepOf(e.from), to: stepOf(e.to) }));

  const members = new Map<string, Node[]>();
  for (const n of pipeline.nodes) {
    const name = groupOf(n.id);
    if (name !== undefined) members.set(name, [...(members.get(name) ?? []), n]);
  }

  // Each stage first: its steps in one column. It then takes part in the canvas layout as one
  // box of that size.
  const inner = new Map(
    [...members].map(([name, steps]) => [name, column(steps, links, sizeOf)] as const),
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
      ...pipeline.nodes.filter((n) => groupOf(n.id) === undefined).map((n) => ({ id: n.id, ...sizeOf(n) })),
      ...[...inner].map(([name, g]) => ({
        id: `group:${name}`,
        width: Math.round(Math.max(g.width + STAGE_PAD_X * 2, MIN_STAGE_CARD_WIDTH)),
        height: Math.round(Math.max(g.height + STAGE_HEAD_HEIGHT + STAGE_FOOTER_HEIGHT + 36, MIN_STAGE_CARD_HEIGHT)),
      })),
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
  // All stage cards sit at the same top horizontal level by default and in Tidy,
  // so that all stage headers and titles align horizontally side-by-side.
  const stageGroupsList = (outer.children ?? [])
    .filter((c) => c.id.startsWith("group:"))
    .sort((a, b) => (a.x ?? 0) - (b.x ?? 0));
  const commonStageTopY = Math.round(stageGroupsList.length > 0 ? Math.min(...stageGroupsList.map((c) => c.y ?? 0)) : 0);

  // Guarantee sequential non-overlapping columns horizontally
  let prevRight = 0;
  const groupPlacedX = new Map<string, number>();
  for (const child of stageGroupsList) {
    const assignedX = Math.round(Math.max(child.x ?? 0, prevRight > 0 ? prevRight + 64 : (child.x ?? 0)));
    groupPlacedX.set(child.id, assignedX);
    const g = inner.get(child.id.slice("group:".length));
    const cardWidth = Math.round(child.width ?? Math.max((g?.width ?? 0) + STAGE_PAD_X * 2, MIN_STAGE_CARD_WIDTH));
    prevRight = assignedX + cardWidth;
  }

  for (const child of outer.children ?? []) {
    if (!child.id.startsWith("group:")) {
      nodes.set(child.id, { x: Math.round(child.x ?? 0), y: Math.round(child.y ?? 0) });
      continue;
    }
    const x = Math.round(groupPlacedX.get(child.id) ?? (child.x ?? 0));
    const y = commonStageTopY;
    const name = child.id.slice("group:".length);
    const g = inner.get(name);
    const steps = g?.at ?? new Map<string, Point>();
    const cardWidth = Math.round(child.width ?? Math.max((g?.width ?? 0) + STAGE_PAD_X * 2, MIN_STAGE_CARD_WIDTH));
    const cardHeight = Math.round(child.height ?? Math.max(((g?.height ?? 0) + STAGE_HEAD_HEIGHT + STAGE_FOOTER_HEIGHT + 36), MIN_STAGE_CARD_HEIGHT));
    for (const [id, p] of steps) {
      nodes.set(id, { x: Math.round(x + STAGE_PAD_X + p.x), y: Math.round(y + STAGE_HEAD_HEIGHT + p.y) });
    }
    groups.push({
      id: name,
      count: steps.size,
      x,
      y,
      width: cardWidth,
      height: cardHeight,
    });
  }
  return { nodes, groups };
}

/** Steps at the layout's places, except steps the person dragged, which stay where they were
 * dropped. With nothing dragged (Tidy), every step is where the layout puts it. */
export function keepDragged<T extends { id: string; position: Point }>(computed: T[], shown: T[], dragged: ReadonlySet<string>): T[] {
  const at = new Map(shown.map((n) => [n.id, n.position]));
  return computed.map((n) => ({ ...n, position: dragged.has(n.id) ? (at.get(n.id) ?? n.position) : n.position }));
}

const STAGE_GAP = 28;

/** A stage's steps in one column: each below the steps it reads, otherwise in flow order.
 * Compact and predictable, whatever the steps' size. */
function column(steps: Node[], links: { from: string; to: string }[], sizeOf: (node: Node) => Size) {
  const ids = steps.map((s) => s.id);
  const inside = new Set(ids);
  const before = new Map(ids.map((id) => [id, new Set(links.filter((l) => l.to === id && inside.has(l.from)).map((l) => l.from))]));
  const placed = new Set<string>();
  const order: Node[] = [];
  for (;;) {
    // The first step (in flow order) whose readers-from are all placed; a cycle cannot happen
    // in a compiled flow, but fall back to flow order rather than loop.
    const waiting = steps.filter((s) => !placed.has(s.id));
    const next = waiting.find((s) => [...(before.get(s.id) ?? [])].every((b) => placed.has(b))) ?? waiting[0];
    if (!next) break;
    placed.add(next.id);
    order.push(next);
  }
  const at = new Map<string, Point>();
  let y = 0;
  let width = 0;
  for (const step of order) {
    const size = sizeOf(step);
    at.set(step.id, { x: 0, y });
    y += size.height + STAGE_GAP;
    width = Math.max(width, size.width);
  }
  return { at, width, height: Math.max(0, y - STAGE_GAP) };
}
