import type { MethodologyRule } from "@sprisk/contracts";

import { chapters } from "./flowGraph.ts";
import { LANE_NOTE, type OnFlow } from "./ruleTree.ts";

/** The canvas, in its own units: decisions left to right on three lines, the shared trunk in
 * the middle, the supervised branch above and the unsupervised branch below. */
export const MAP = { left: 150, step: 200, stageGap: 48, trunk: 520, above: 290, below: 800, height: 960, routeDy: 36, forkDy: 90, label: 16 } as const;

/** How a decision is settled, from its rule: a decision on the question that reads only what a
 * person states is asked; any other the data settles. */
export type Level = "rule" | "ask";

export type MapNode =
  | { kind: "decision"; id: string; rule: MethodologyRule; level: Level; x: number; y: number; lines: string[]; lift: number; decided: OnFlow | undefined; onPath: boolean }
  | { kind: "fork"; id: "fork"; x: number; y: number; lines: string[]; lift: number; onPath: boolean }
  | { kind: "end"; id: string; x: number; y: number; lines: string[]; lift: number; onPath: boolean };

/** A route: the dot it is drawn through, halfway to the decision it leads on to. */
/** `label` is shortened to fit the canvas; `name` is the route's whole name. */
export type MapRoute = { id: string; from: string; to: string; x: number; y: number; name: string; label: string; title: string; loop: boolean; chosen: boolean };

export type MapBand = { key: string; title: string; caption: string; left: number; width: number; top: number; height: number; live: boolean };

export type MapLayout = { nodes: MapNode[]; routes: MapRoute[]; bands: MapBand[]; lanes: { lane: string; y: number; caption: string }[]; width: number; height: number };

/** How far above its mark a node's words end, at least; more when a route's dot beside it is
 * higher, so the words clear the route's name. */
const LIFT = 40;

const MEASURED = /^(column|input|target|rows|flow|step|candidate|cv|join)\b/;

export function levelOf(rule: MethodologyRule): Level {
  const asked = rule.decides.startsWith("question.") && (rule.reads ?? []).every((r) => !MEASURED.test(r));
  return asked ? "ask" : "rule";
}

/** A route's name as short as the canvas has room for; the whole name is in its tooltip. */
export const short = (text: string) => (text.length > MAP.label ? `${text.slice(0, MAP.label - 1).trimEnd()}…` : text);

/** Words wrapped to lines of at most `max` characters. */
export function wrap(text: string, max: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (line && `${line} ${word}`.length > max) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  return line ? [...lines, line] : lines;
}

/** The methodology as one canvas, like a map a model walks (ADR-0059): every decision a node
 * marked by its level, each route a dot halfway to the next decision, a fork on whether the
 * question has a target, and the one scoring of the test rows at the end of each branch. With
 * `path`, the routes the selected flow's rules chose are marked `chosen`. */
export function mapLayout(rules: MethodologyRule[], decided: Map<string, OnFlow>, { path }: { path: boolean }): MapLayout {
  const all = chapters(rules);
  const shared = all.filter((c) => c.lane === undefined);
  const laneNames = [...new Set(all.flatMap((c) => (c.lane ? [c.lane] : [])))];
  const yOf = (lane: string | undefined) => (lane === undefined ? MAP.trunk : lane === laneNames[0] ? MAP.above : MAP.below);
  const onPath = (rule: MethodologyRule) => decided.get(rule.id)?.step !== undefined;
  const nodes: MapNode[] = [];
  const bands: MapBand[] = [];
  const place = new Map<string, { x: number; y: number }>();

  // Positions: one column per decision, a gap between stages; both branches start after the fork.
  let x: number = MAP.left;
  const placeChapter = (c: (typeof all)[number], at: number) => {
    let cx = at;
    const y = yOf(c.lane);
    const first = cx;
    for (const rule of c.rules) {
      place.set(rule.id, { x: cx, y });
      nodes.push({ kind: "decision", id: rule.id, rule, level: levelOf(rule), x: cx, y, lines: wrap(rule.question ?? rule.name, 22), lift: LIFT, decided: decided.get(rule.id), onPath: onPath(rule) });
      cx += MAP.step;
    }
    const zone = c.lane === undefined ? { top: 60, height: 880 } : c.lane === laneNames[0] ? { top: 60, height: 400 } : { top: 590, height: 350 };
    bands.push({
      key: c.key,
      title: c.stage.toUpperCase(),
      caption: `${c.rules.length} decision${c.rules.length === 1 ? "" : "s"}`,
      left: first - 60,
      width: cx - MAP.step - first + 136,
      ...zone,
      live: c.lane === undefined || c.rules.some(onPath) || !path,
    });
    return cx + MAP.stageGap;
  };
  for (const c of shared) x = placeChapter(c, x);
  const forkX = x;
  nodes.push({ kind: "fork", id: "fork", x: forkX, y: MAP.trunk, lines: ["Does the question", "have a target?"], lift: LIFT, onPath: path && rules.some(onPath) });
  place.set("fork", { x: forkX, y: MAP.trunk });
  bands.push({ key: "fork", title: "FORK", caption: "target?", left: forkX - 60, width: 136, top: 60, height: 880, live: true });
  let end = forkX;
  for (const lane of laneNames) {
    let lx = forkX + MAP.step + MAP.stageGap;
    for (const c of all.filter((ch) => ch.lane === lane)) lx = placeChapter(c, lx);
    const endId = `end:${lane}`;
    nodes.push({ kind: "end", id: endId, x: lx, y: yOf(lane), lines: ["Final scoring"], lift: LIFT, onPath: path && laneRulesOnPath(all, lane, onPath) });
    place.set(endId, { x: lx, y: yOf(lane) });
    end = Math.max(end, lx);
  }

  // Routes: each decision's dots, halfway to the decision after it in its line.
  const routes: MapRoute[] = [];
  const sequence = (lane: string | undefined) => all.filter((c) => c.lane === lane).flatMap((c) => c.rules.map((r) => r.id));
  const trunk = sequence(undefined);
  const after = (id: string, line: string[], last: string) => line[line.indexOf(id) + 1] ?? last;
  const firstOfStage = (lane: string, stage: string) => all.find((c) => c.lane === lane && c.stage === stage)?.rules[0]?.id;
  const fan = (rule: MethodologyRule, next: string, lane: string | undefined) => {
    const from = place.get(rule.id)!;
    const to = place.get(next)!;
    const dx = Math.round((to.x - from.x) / 2);
    const chosen = decided.get(rule.id);
    const options = rule.alternatives;
    if (options.length === 0) {
      routes.push({ id: `${rule.id}#best`, from: rule.id, to: next, x: from.x + dx, y: from.y, name: "best on the same folds", label: "best on the same folds", title: "The shortlist's models are compared on the same folds; the best one wins.", loop: false, chosen: path && onPath(rule) });
      return;
    }
    options.forEach((route, k) => {
      const params = route.action.params as Record<string, unknown> | undefined;
      const stage = route.action.type === "reopen" ? String(params?.stage ?? "") : "";
      const back = lane !== undefined && stage ? firstOfStage(lane, stage) : undefined;
      routes.push({
        id: `${rule.id}#${route.id}`,
        from: rule.id,
        to: back ?? next,
        x: from.x + dx,
        y: from.y + Math.round((k - (options.length - 1) / 2) * MAP.routeDy),
        name: route.label,
        label: short(route.label),
        title: `${route.label}: ${route.when ?? route.rationale}`,
        loop: back !== undefined,
        chosen: path && onPath(rule) && chosen?.option === route.id,
      });
    });
  };
  for (const id of trunk) fan(rules.find((r) => r.id === id)!, after(id, trunk, "fork"), undefined);
  laneNames.forEach((lane, i) => {
    const line = sequence(lane);
    const first = line[0];
    if (first) {
      routes.push({ id: `fork#${lane}`, from: "fork", to: first, x: forkX + 68, y: MAP.trunk + (i === 0 ? -MAP.forkDy : MAP.forkDy), name: `${i === 0 ? "yes" : "no"} · ${lane}`, label: `${i === 0 ? "yes" : "no"} · ${lane}`, title: LANE_NOTE[lane] ?? `the ${lane} pack`, loop: false, chosen: path && laneRulesOnPath(all, lane, onPath) });
    }
    for (const id of line) fan(rules.find((r) => r.id === id)!, after(id, line, `end:${lane}`), lane);
  });

  // Words clear the highest route dot either side of their node.
  for (const r of routes) {
    for (const id of [r.from, r.to]) {
      const n = nodes.find((m) => m.id === id);
      // The fork's dots sit by the fork, far from the branch they lead into.
      if (n && !r.loop && r.from !== "fork") n.lift = Math.max(n.lift, n.y - r.y + 28);
    }
  }

  return {
    nodes,
    routes,
    bands,
    lanes: [
      { lane: "trunk", y: MAP.height - 36, caption: "TRUNK · EVERY INVESTIGATION PASSES HERE" },
      ...laneNames.map((lane, i) => ({ lane, y: i === 0 ? MAP.trunk - 80 : MAP.height - 36, caption: `${lane.toUpperCase()} BRANCH · ${(LANE_NOTE[lane] ?? lane).toUpperCase()}` })),
    ],
    width: end + 300,
    height: MAP.height,
  };
}

function laneRulesOnPath(all: ReturnType<typeof chapters>, lane: string, onPath: (r: MethodologyRule) => boolean) {
  return all.some((c) => c.lane === lane && c.rules.some(onPath));
}

/** A route's curve through its dot: out of the decision, then on to the next one, or, for a
 * route that loops back, an arc over the line to the stage it reopens. */
export function routePath(route: MapRoute, from: { x: number; y: number }, to: { x: number; y: number }, endNode: boolean): string {
  const seg = (x1: number, y1: number, x2: number, y2: number) => {
    const m = (x1 + x2) / 2;
    return `M${x1} ${y1}C${m} ${y1} ${m} ${y2} ${x2} ${y2}`;
  };
  const tx = to.x - (endNode ? 14 : 9);
  const out = seg(from.x + 9, from.y, route.x, route.y);
  if (!route.loop) return out + seg(route.x, route.y, tx, to.y);
  const arc = Math.min(route.y, to.y) - 150;
  return `${out}M${route.x} ${route.y}C${route.x + 90} ${arc} ${tx - 90} ${arc} ${tx} ${to.y}`;
}
