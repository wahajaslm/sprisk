import type { Operator } from "@sprisk/contracts";

/** Presentation grouping only (rule 9: layout is not provenance). */
export const STAGES = ["Explore", "Split", "Clean", "Model", "Evaluate", "Unknown"] as const;
export type Stage = (typeof STAGES)[number];

/** Studio node kinds: they pick the icon and its tint. */
export type NodeKind = "source" | "recipe" | "view" | "decision" | "model";

export function stageOf(operator: Operator): Stage {
  const domain = operator.id.split(".")[1];
  if (domain === "validation") return "Split";
  if (domain === "clean") return "Clean";
  switch (operator.capability_class) {
    case "source":
    case "analyzer":
      return "Explore";
    case "estimator":
      return "Model";
    case "evaluator":
      return "Evaluate";
    default:
      return "Clean";
  }
}

export function kindOf(operator: Operator): NodeKind {
  switch (operator.capability_class) {
    case "source":
      return "source";
    case "estimator":
      return "model";
    case "evaluator":
      return "view";
    default:
      return "recipe";
  }
}

/** "sprisk.clean.impute@1.0.0" → "impute". */
export const shortName = (ref: string) => ref.split("@")[0]?.split(".").at(-1) ?? ref;

/** Two-digit stage number as Studio shows it: "01". */
export const stageNumber = (stage: Stage) => String(STAGES.indexOf(stage) + 1).padStart(2, "0");

/** The profile step writes one DuckDB SUMMARIZE row per data column. Matched by operator
 * because ports do not declare their table shape yet (docs/backlog.md). */
export const isProfileOperator = (ref: string | undefined) => ref?.startsWith("sprisk.profile.summarize@") === true;

/** One entry per operator name: its highest `major.minor.patch` version. */
export function newestVersions(operators: Operator[]): Operator[] {
  const parts = (id: string) => (id.split("@")[1] ?? "").split(".").map(Number);
  const newer = (a: string, b: string) => {
    const [x, y] = [parts(a), parts(b)];
    for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
    return false;
  };
  const best = new Map<string, Operator>();
  for (const op of operators) {
    const name = op.id.split("@")[0] ?? op.id;
    const seen = best.get(name);
    if (!seen || newer(op.id, seen.id)) best.set(name, op);
  }
  return [...best.values()];
}
