import type { Method } from "@sprisk/contracts";

import { numbered } from "./decisionOrder.ts";

export type InputKind = NonNullable<Method["changes"]>[number];

/** Lanes top to bottom; a step changing two kinds spans them, so neighbours can share one. */
export const LANES: { kind: InputKind; label: string }[] = [
  { kind: "numbers", label: "Numbers" },
  { kind: "categories", label: "Categories" },
  { kind: "dates", label: "Dates" },
  { kind: "text", label: "Free text" },
  { kind: "image", label: "Images" },
  { kind: "audio", label: "Audio" },
];

/** `column`: after every earlier step in any of its lanes, so steps in other lanes sit beside it. */
export type LaneStep = { method: Method; lanes: InputKind[]; column: number };
export type Lane = { kind: InputKind; label: string; steps: LaneStep[] };

/** What the methods do to the data, in the order it happens: steps on the whole table, the
 * split, a lane per kind of model input, then settings on the model. `noStep` holds the
 * decisions that only set what later ones read. */
export type DataFlow = { noStep: Method[]; table: Method[]; split: Method | undefined; lanes: Lane[]; columns: number; afterModel: Method[] };

export function dataFlow(methods: Method[]): DataFlow {
  const flow: DataFlow = { noStep: [], table: [], split: undefined, lanes: [], columns: 0, afterModel: [] };
  const steps: LaneStep[] = [];
  const last = new Map<InputKind, number>();
  for (const { method } of numbered(methods)) {
    const actions = method.options.flatMap((o) => (o.action ? [o.action] : []));
    if (actions.some((a) => a.replace?.role === "split")) flow.split = method;
    else if (actions.some((a) => a.set?.role === "model")) flow.afterModel.push(method);
    else if (actions.some((a) => a.insert?.before === "model") && method.changes) {
      const lanes = LANES.map((l) => l.kind).filter((k) => method.changes!.includes(k));
      const column = Math.max(...lanes.map((k) => (last.get(k) ?? -1) + 1));
      for (const k of lanes) last.set(k, column);
      steps.push({ method, lanes, column });
    } else if (actions.some((a) => a.insert || a.replace)) flow.table.push(method);
    else flow.noStep.push(method);
  }
  flow.lanes = LANES.filter((l) => last.has(l.kind)).map((l) => ({ ...l, steps: steps.filter((s) => s.lanes.includes(l.kind)) }));
  flow.columns = Math.max(0, ...steps.map((s) => s.column + 1));
  return flow;
}
