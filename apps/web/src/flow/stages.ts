import type { Node, Operator, PipelineVersion } from "@sprisk/contracts";
import { isCodeOperator } from "./edit.ts";
import { stepOf } from "./ports.ts";

/** Presentation grouping only (rule 9: layout is not provenance). */
/** The standard stages, in working order (ADR-0055, ADR-0065): read the data, look at all of it,
 * clean what needs no fitting, set the test rows aside, build features fitted on the training
 * rows, model and evaluate. A method's activity is a label inside a stage, never a stage. */
export const STAGES = ["Load", "Explore", "Clean", "Split", "Features", "Model", "Evaluate", "Unknown"] as const;
export type Stage = (typeof STAGES)[number];

/** Each stage's name for people. */
export const STAGE_TITLE: Record<Stage, string> = {
  Load: "Data loading",
  Explore: "Data exploration",
  Split: "Train/test split",
  Clean: "Data cleaning",
  Features: "Feature engineering",
  Model: "Modeling",
  Evaluate: "Evaluation",
  Unknown: "Other steps",
};

/** What each stage is for, in a few words, under its name on the canvas. */
export const STAGE_PURPOSE: Record<Stage, string> = {
  Load: "Read the source files",
  Explore: "Look at every row before deciding",
  Clean: "Fix columns, duplicates and text before the split",
  Split: "Set the test rows aside and check what was written",
  Features: "Fitted on the training rows: impute, encode, scale, vectorize",
  Model: "Fit and compare models",
  Evaluate: "Score once on the test rows",
  Unknown: "Steps with no stage yet",
};

/** Studio node kinds: they pick the icon and its tint. */
export type NodeKind = "source" | "recipe" | "view" | "decision" | "model";

export function stageOf(operator: Operator): Stage {
  const domain = operator.id.split(".")[1];
  if (domain === "validation") return "Split";
  if (domain === "clean") return "Clean";
  if (domain === "clustering") return "Model";
  switch (operator.capability_class) {
    case "source":
      return "Load";
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

/** "sprisk.clean.impute@1.0.0" → "impute". */
export const shortName = (ref: string) => ref.split("@")[0]?.split(".").at(-1) ?? ref;

/** "sprisk.ml.linear_model@1.0.0" → "Linear model": the name a person reads in a list. */
/** A step's name for people: its manifest's title, the standard term for what it does; the
 * operator's name stands in for one without a title. */
export function stepTitle(ref: string, operator?: Operator): string {
  if (operator?.title) return operator.title;
  const words = shortName(ref).replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** How a step reads to people (ADR-0055): its kind as the title (Box plot, Random split), and
 * what it is about, from its id, below. */
export function stepLabel(node: Node, operator?: Operator): { title: string; subject: string } {
  const title = node.title ?? (isCodeOperator(node.operator) ? "Python code" : stepTitle(node.operator, operator));
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

/** Where a step on the canvas comes from, so its shape says it (ADR-0063): a method's decision
 * placed or set it, it measures evidence for a method, or it was written as it stands. */
export type StepOrigin = "decided" | "measures" | "written";

export function stepOrigin(node: Node, operator: Operator | undefined): StepOrigin {
  if (node.methodology_decision_id !== undefined) return "decided";
  if (Object.keys(operator?.produces ?? {}).length > 0) return "measures";
  return "written";
}
