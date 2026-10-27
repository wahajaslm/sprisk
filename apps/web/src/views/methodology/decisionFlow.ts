import type { Method } from "@sprisk/contracts";

import { type OrderedMethod, numbered, stageOf, STAGES } from "./decisionOrder.ts";

/** The flowchart's sizes: a diamond per decision, a circle per choice under it. */
export const FLOW = { diamond: 34, choice: { width: 210, height: 78, circle: 18 }, gap: 24, toChoices: 70, toNext: 70, stage: 56 } as const;

export type FlowNode =
  | { kind: "stage"; id: string; title: string; x: number; y: number }
  | { kind: "decision"; id: string; ordered: OrderedMethod; x: number; y: number }
  | { kind: "choice"; id: string; method: Method; option: Method["options"][number]; x: number; y: number }
  | { kind: "end"; id: string; label: string; x: number; y: number };
export type FlowLink = { id: string; from: string; to: string };
export type DecisionFlow = { nodes: FlowNode[]; links: FlowLink[] };

/** The decisions as one flowchart, read top to bottom: each decision is a diamond, its
 * choices sit under it, and every choice leads on to the next decision, since the engine
 * makes every decision in turn and each takes one of its choices. Positions are centred on
 * x = 0; a node's x, y is its top-left corner. */
export function decisionFlow(methods: Method[], end: string): DecisionFlow {
  const nodes: FlowNode[] = [];
  const links: FlowLink[] = [];
  let y = 0;
  let stage: string | undefined;
  let before: string[] = [];
  const widest = Math.max(1, ...methods.map((m) => m.options.length));
  const left = -(widest * FLOW.choice.width + (widest - 1) * FLOW.gap) / 2;
  for (const ordered of numbered(methods)) {
    const { method } = ordered;
    const key = stageOf(method.decides);
    if (key !== stage) {
      stage = key;
      nodes.push({ kind: "stage", id: `stage:${key}`, title: STAGES.find(([k]) => k === key)?.[1] ?? key, x: left, y });
      y += FLOW.stage;
    }
    const decision = `decision:${method.id}`;
    nodes.push({ kind: "decision", id: decision, ordered, x: -FLOW.diamond / 2, y });
    links.push(...before.map((from) => ({ id: `${from}>${decision}`, from, to: decision })));
    y += FLOW.diamond + FLOW.toChoices;
    const count = method.options.length;
    const row = count * FLOW.choice.width + (count - 1) * FLOW.gap;
    before = method.options.map((option, at) => {
      const id = `choice:${method.id}#${option.id}`;
      nodes.push({ kind: "choice", id, method, option, x: -row / 2 + at * (FLOW.choice.width + FLOW.gap), y });
      links.push({ id: `${decision}>${id}`, from: decision, to: id });
      return id;
    });
    y += FLOW.choice.height + FLOW.toNext;
  }
  const last = "end";
  nodes.push({ kind: "end", id: last, label: end, x: -FLOW.diamond / 2, y });
  links.push(...before.map((from) => ({ id: `${from}>${last}`, from, to: last })));
  return { nodes, links };
}
