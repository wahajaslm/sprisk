import type { Operator } from "@sprisk/contracts";

/** Presentation grouping only (rule 9: layout is not provenance). */
export const STAGES = ["Explore", "Split", "Clean", "Model", "Evaluate"] as const;
export type Stage = (typeof STAGES)[number];

export type NodeKind = "data" | "step" | "model";

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
  if (operator.capability_class === "source") return "data";
  if (operator.capability_class === "estimator") return "model";
  return "step";
}
