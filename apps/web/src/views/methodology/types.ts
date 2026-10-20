export type MethodologyPack = "supervised" | "unsupervised";

export type MethodologyStageId =
  | "question"
  | "ingestion"
  | "cleaning"
  | "split"
  | "features"
  | "modeling"
  | "eval"
  | "governance";

export interface MethodologyStage {
  id: MethodologyStageId;
  order: number;
  label: string;
  tagline: string;
  scientificGoal: string;
  icon: string;
}

export interface RuleProvenance {
  standard: string;
  citation: string;
  pitfall: string;
  cornerCases: string[];
}

export interface RuleObservable {
  kind: "fact" | "profile";
  key: string;
  description: string;
  required: boolean;
}

export interface RuleAlternative {
  id: string;
  label: string;
  description: string;
  condition: string;
  rationale: string;
  operator?: string;
  actionSummary?: string;
}

export interface PolicyThresholdConfig {
  key: string;
  label: string;
  description: string;
  type: "number" | "boolean" | "select";
  value: number | boolean | string;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  options?: { value: string; label: string }[];
}

export interface MethodologyRule {
  id: string;
  name: string;
  pack: MethodologyPack;
  stage: MethodologyStageId;
  decides: string;
  provenance: RuleProvenance;
  observes: RuleObservable[];
  policyThresholds: PolicyThresholdConfig[];
  alternatives: RuleAlternative[];
  verificationCheck: {
    checkRule: string;
    description: string;
    gate: "B";
  };
}

export interface PolicyPreset {
  id: string;
  name: string;
  description: string;
  tagline: string;
  strictness: "strict" | "balanced" | "exploratory";
  thresholdOverrides: Record<string, number | boolean | string>;
}
