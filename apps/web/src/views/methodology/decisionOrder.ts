import type { Method, Operator } from "@sprisk/contracts";
import ELK from "elkjs/lib/elk.bundled.js";
import type { ElkNode } from "elkjs/lib/elk-api";

const elk = new ELK();

/** A method on the canvas: a numbered circle with its name beside it. */
export const NODE = { width: 240, height: 40, circle: 28 } as const;
/** A measurement that starts a method: a small square with the step that measures it. */
export const MEASURE = { width: 200, height: 30, square: 12 } as const;
const STAGE_PAD = { top: 44, side: 20, bottom: 20 } as const;
const STAGE_GAP = 56;

/** Stages in decision order (ADR-0059): the area of a decision key names its stage. */
const STAGES = [
  ["question", "Question"],
  ["data", "Data, before the split"],
  ["split", "Split"],
  ["features", "Features, on the train rows"],
  ["evaluation", "Evaluation"],
] as const;

/** Missing values are filled with the other feature steps, so they share the stage. */
const stageOf = (decides: string) => {
  const area = decides.split(".")[0] ?? decides;
  return area === "cleaning" ? "features" : area;
};

export type OrderedMethod = { method: Method; order: number };
export type StageBox = { id: string; title: string; x: number; y: number; width: number; height: number };
export type MethodBox = OrderedMethod & { x: number; y: number; width: number; height: number; stage: string };
/** One evidence kind, and the steps that measure it. */
export type MeasureBox = { id: string; kind: string; by: string[]; x: number; y: number; width: number; height: number; stage: string };
/** `waits`: a method reads another's decision. `measures`: evidence a method decides from. */
export type OrderEdge = { id: string; from: string; to: string; kind: "waits" | "measures" };
export type DecisionOrder = { stages: StageBox[]; methods: MethodBox[]; measures: MeasureBox[]; edges: OrderEdge[] };

/** Numbers in reading order: stage by stage, and inside a stage each method after the
 * decisions it waits for (the API's order breaks ties). */
export function numbered(methods: Method[]): OrderedMethod[] {
  const byDecision = new Map(methods.map((m) => [m.decides, m]));
  const out: Method[] = [];
  const seen = new Set<string>();
  const visit = (m: Method) => {
    if (seen.has(m.decides)) return;
    seen.add(m.decides);
    for (const read of m.needs.decisions) {
      const before = byDecision.get(read);
      if (before && stageOf(before.decides) === stageOf(m.decides)) visit(before);
    }
    out.push(m);
  };
  for (const [key] of STAGES) methods.filter((m) => stageOf(m.decides) === key).forEach(visit);
  methods.forEach(visit);
  return out.map((method, at) => ({ method, order: at + 1 }));
}

/** Where each method sits: stages top to bottom, and inside a stage each method below the
 * decisions it waits for and below the measurements it decides from (ELK's layered layout). */
export async function decisionOrder(methods: Method[], operators: Operator[]): Promise<DecisionOrder> {
  const ordered = numbered(methods);
  const byDecision = new Map(ordered.map((m) => [m.method.decides, m]));
  const waits: OrderEdge[] = ordered.flatMap(({ method }) =>
    method.needs.decisions.flatMap((read) => {
      const from = byDecision.get(read);
      return from ? [{ id: `${read}>${method.decides}`, from: from.method.id, to: method.id, kind: "waits" as const }] : [];
    }),
  );
  // A measurement is drawn in each stage that reads it, so its lines stay inside the stage.
  const measured = new Map<string, { kind: string; stage: string }>();
  for (const { method } of ordered) {
    const stage = stageOf(method.decides);
    for (const kind of method.needs.evidence) measured.set(measureId(stage, kind), { kind, stage });
  }
  const measureEdges: OrderEdge[] = ordered.flatMap(({ method }) =>
    method.needs.evidence.map((kind) => ({ id: `${kind}>>${method.decides}`, from: measureId(stageOf(method.decides), kind), to: method.id, kind: "measures" as const })),
  );
  const producers = (kind: string) => operators.filter((o) => o.produces?.[kind] !== undefined).map((o) => o.title ?? o.id);
  const edges = [...measureEdges, ...waits];
  const stages = STAGES.filter(([key]) => ordered.some((m) => stageOf(m.method.decides) === key));
  // Each stage on its own, then the stages stacked left-aligned, top to bottom; a line between
  // stages is drawn by the canvas and takes no part in either layout.
  const laidStages = await Promise.all(
    stages.map(async ([key, title]) => {
      const ids = new Set<string>();
      const children = [
        ...[...measured].filter(([, m]) => m.stage === key).map(([id]) => ({ id, width: MEASURE.width, height: MEASURE.height })),
        ...ordered.filter((m) => stageOf(m.method.decides) === key).map((m) => ({ id: m.method.id, width: NODE.width, height: NODE.height })),
      ];
      children.forEach((c) => ids.add(c.id));
      const graph: ElkNode = {
        id: key,
        layoutOptions: {
          "elk.algorithm": "layered",
          "elk.direction": "DOWN",
          "elk.layered.spacing.nodeNodeBetweenLayers": "28",
          "elk.spacing.nodeNode": "20",
          "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
        },
        children,
        edges: edges.filter((e) => ids.has(e.from) && ids.has(e.to)).map((e) => ({ id: e.id, sources: [e.from], targets: [e.to] })),
      };
      return { key, title, inner: await elk.layout(graph) };
    }),
  );
  const stageBoxes: StageBox[] = [];
  const methodBoxes: MethodBox[] = [];
  const measureBoxes: MeasureBox[] = [];
  const width = Math.max(...laidStages.map((s) => (s.inner.width ?? 0) + STAGE_PAD.side * 2));
  let y = 0;
  for (const { key, title, inner } of laidStages) {
    const id = `stage:${key}`;
    const height = (inner.height ?? 0) + STAGE_PAD.top + STAGE_PAD.bottom;
    stageBoxes.push({ id, title, x: 0, y, width, height });
    y += height + STAGE_GAP;
    for (const child of inner.children ?? []) {
      const at = { x: (child.x ?? 0) + STAGE_PAD.side, y: (child.y ?? 0) + STAGE_PAD.top };
      const measure = measured.get(child.id);
      if (measure) {
        const kind = measure.kind;
        measureBoxes.push({ id: child.id, kind, by: producers(kind), stage: id, ...at, width: MEASURE.width, height: MEASURE.height });
        continue;
      }
      const m = ordered.find((o) => o.method.id === child.id);
      if (m) methodBoxes.push({ ...m, stage: id, ...at, width: NODE.width, height: NODE.height });
    }
  }
  return { stages: stageBoxes, methods: methodBoxes, measures: measureBoxes, edges };
}

const measureId = (stage: string, kind: string) => `measure:${stage}:${kind}`;

/** What a choice does to the flow, in a few words. */
export function effect(option: Method["options"][number]): string {
  const action = option.action;
  if (action?.insert) return `adds ${short(action.insert.operator)} before ${action.insert.before}`;
  if (action?.replace) return `uses ${short(action.replace.operator)} as the ${action.replace.role}`;
  if (action?.set) return `sets the ${action.set.role}'s settings`;
  if (action?.bind) return `names ${action.bind.concept}`;
  return "changes nothing";
}

/** `sprisk.clean.impute@1.0.0` → `impute`. */
const short = (operator: string) => operator.split("@")[0]?.split(".").pop() ?? operator;
