import type { Method } from "@sprisk/contracts";

/** Stages in decision order (ADR-0059): the area of a decision key names its stage. */
export const STAGES = [
  ["question", "Problem definition"],
  ["data", "Data preparation"],
  ["split", "Data splitting"],
  ["features", "Feature engineering"],
  ["evaluation", "Evaluation"],
] as const;

/** Missing values are filled with the other feature steps, so they share the stage. */
export const stageOf = (decides: string) => {
  const area = decides.split(".")[0] ?? decides;
  return area === "cleaning" ? "features" : area;
};

export type OrderedMethod = { method: Method; order: number };

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
