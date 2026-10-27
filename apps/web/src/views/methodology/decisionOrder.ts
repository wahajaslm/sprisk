import type { Method } from "@sprisk/contracts";
import ELK from "elkjs/lib/elk.bundled.js";

const elk = new ELK();

/** A method's card: its head, then one line per choice. */
export const CARD = { width: 300, head: 76, choice: 40, foot: 10 } as const;
const STAGE_PAD = { top: 44, side: 16, bottom: 16 } as const;

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
export type WaitEdge = { id: string; from: string; to: string };
export type DecisionOrder = { stages: StageBox[]; methods: MethodBox[]; edges: WaitEdge[] };

/** Where each method sits: stages top to bottom, and inside a stage each method below the
 * decisions it waits for (ELK's layered layout). The API lists methods in decision order. */
export async function decisionOrder(methods: Method[]): Promise<DecisionOrder> {
  const ordered = methods.map((method, at) => ({ method, order: at + 1 }));
  const byDecision = new Map(ordered.map((m) => [m.method.decides, m]));
  const edges: WaitEdge[] = ordered.flatMap(({ method }) =>
    method.needs.decisions.flatMap((read) => {
      const from = byDecision.get(read);
      return from ? [{ id: `${read}>${method.decides}`, from: from.method.id, to: method.id }] : [];
    }),
  );
  const stages = STAGES.filter(([key]) => ordered.some((m) => stageOf(m.method.decides) === key));
  const laid = await elk.layout({
    id: "order",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "DOWN",
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
      "elk.layered.spacing.nodeNodeBetweenLayers": "36",
      "elk.spacing.nodeNode": "24",
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
    },
    children: stages.map(([key]) => ({
      id: `stage:${key}`,
      layoutOptions: {
        "elk.padding": `[top=${STAGE_PAD.top},left=${STAGE_PAD.side},bottom=${STAGE_PAD.bottom},right=${STAGE_PAD.side}]`,
      },
      children: ordered
        .filter((m) => stageOf(m.method.decides) === key)
        .map((m) => ({ id: m.method.id, width: CARD.width, height: cardHeight(m.method) })),
    })),
    // Stages follow one another even where no method waits across them.
    edges: [
      ...stages.slice(1).map(([key], at) => ({ id: `order:${key}`, sources: [`stage:${stages[at]![0]}`], targets: [`stage:${key}`] })),
      ...edges.map((e) => ({ id: e.id, sources: [e.from], targets: [e.to] })),
    ],
  });
  const stageBoxes: StageBox[] = [];
  const methodBoxes: MethodBox[] = [];
  for (const stage of laid.children ?? []) {
    const key = stage.id.slice("stage:".length);
    const title = stages.find(([k]) => k === key)?.[1] ?? key;
    stageBoxes.push({ id: stage.id, title, x: stage.x ?? 0, y: stage.y ?? 0, width: stage.width ?? 0, height: stage.height ?? 0 });
    for (const child of stage.children ?? []) {
      const m = ordered.find((o) => o.method.id === child.id);
      if (!m) continue;
      methodBoxes.push({ ...m, stage: stage.id, x: child.x ?? 0, y: child.y ?? 0, width: child.width ?? CARD.width, height: child.height ?? 0 });
    }
  }
  return { stages: stageBoxes, methods: methodBoxes, edges };
}

export const cardHeight = (method: Method) => CARD.head + CARD.choice * method.options.length + CARD.foot;

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
