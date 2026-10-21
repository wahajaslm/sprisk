import type { Node, Operator, PipelineVersion } from "@sprisk/contracts";
import { isCodeOperator } from "./edit.ts";
import { stepOf } from "./ports.ts";

/** Presentation grouping only (rule 9: layout is not provenance). */
export const STAGES = ["Explore", "Split", "Clean", "Model", "Evaluate", "Unknown"] as const;
export type Stage = (typeof STAGES)[number];

/** Studio node kinds: they pick the icon and its tint. */
export type NodeKind = "source" | "recipe" | "view" | "decision" | "model";

export function stageOf(operator: Operator): Stage {
  const domain = operator.id.split(".")[1];
  if (domain === "validation") return "Split";
  if (domain === "clean") return "Clean";
  if (domain === "clustering") return "Model";
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
  const domain = operator.id.split(".")[1];
  if (domain === "clustering") return "model";
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

const ROLE: Record<Operator["capability_class"], string> = {
  source: "Data source",
  transform: "Transform",
  analyzer: "Analysis",
  estimator: "Model",
  evaluator: "Evaluation",
  optimizer: "Tuning",
  decision_evaluator: "Decision",
  sink: "Export",
  custom_code: "Code",
};

/** What a step is for, in plain words: "Transform", "Model". Code steps say "Code". */
export const roleOf = (operator: Operator) => (operator.id.startsWith("sprisk.code.") ? "Code" : ROLE[operator.capability_class]);

/** The output port that holds a step's figures: a code step's display, else its first
 * `figure` port (ADR-0024). Undefined when the step draws nothing. */
export const figurePortOf = (operator: Operator): string | undefined =>
  isCodeOperator(operator.id) ? "display" : operator.outputs.find((o) => o.kind === "figure")?.name;

/** Heading groups on the canvas: steps of one stage share a heading only where they sit
 * together in the flow (one reads the other, or both read the same step). Otherwise the
 * heading would pull them together and bend lines backwards. Keys look like "Clean#impute";
 * the part before "#" is the stage shown. */
export function stageGroups(pipeline: PipelineVersion, operators: Map<string, Operator>): Map<string, string> {
  const stage = new Map(pipeline.nodes.map((n) => [n.id, operators.get(n.operator)]));
  const stageName = (id: string) => {
    const op = stage.get(id);
    return op ? stageOf(op) : undefined;
  };
  const groups = new Map<string, string>();
  for (const n of pipeline.nodes) {
    const name = stageName(n.id);
    if (name !== undefined) groups.set(n.id, `${name}#${name.toLowerCase()}`);
  }
  return groups;
}

/** "sprisk.clean.impute@1.0.0" → "impute". */
export const shortName = (ref: string) => ref.split("@")[0]?.split(".").at(-1) ?? ref;

/** "sprisk.ml.linear_model@1.0.0" → "Linear model": the name a person reads in a list. */
export function stepTitle(ref: string): string {
  const words = shortName(ref).replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** How a step reads to people (ADR-0055): its kind as the title (Box plot, Random split), and
 * what it is about, from its id, below. */
export function stepLabel(node: Node): { title: string; subject: string } {
  const title = node.title ?? (isCodeOperator(node.operator) ? "Python code" : stepTitle(node.operator));
  return { title, subject: node.id.replaceAll("_", " ") };
}

/** The profile step writes one DuckDB SUMMARIZE row per data column. Matched by operator
 * because ports do not declare their table shape yet (docs/backlog.md). */
export const isProfileOperator = (ref: string | undefined) => ref?.startsWith("sprisk.profile.summarize@") === true;

export const isClusteringOperator = (ref: string | undefined) =>
  ref !== undefined && (ref.startsWith("sprisk.clustering.") || ref.includes(".clustering."));

export const isSpectralGatingOperator = (ref: string | undefined) =>
  ref !== undefined && ref.includes("spectral_gating");

export const isDistributionsOperator = (ref: string | undefined) =>
  ref !== undefined && ref.includes("profile.distributions");

export const isFeatureImportanceOperator = (ref: string | undefined) =>
  ref !== undefined && ref.includes("feature_importance");

export const isClipOutliersOperator = (ref: string | undefined) =>
  ref !== undefined && ref.includes("clip_outliers");

export const isSplitOperator = (ref: string | undefined) =>
  ref !== undefined && (ref.includes(".validation.") || ref.includes("_split"));

export function isAnalysisOperator(ref: string | undefined, capability?: string): boolean {
  if (!ref) return false;
  if (isClusteringOperator(ref)) return true;
  if (isSpectralGatingOperator(ref)) return true;
  if (isFeatureImportanceOperator(ref)) return true;
  if (isDistributionsOperator(ref)) return true;
  if (isClipOutliersOperator(ref)) return true;
  if (isProfileOperator(ref)) return true;
  if (isSplitOperator(ref)) return true;
  if (capability === "evaluator" || capability === "estimator") return true;
  return false;
}


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
