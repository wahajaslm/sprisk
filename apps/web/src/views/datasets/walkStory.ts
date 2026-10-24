import type { FlowDecision, WalkStep } from "@sprisk/contracts";

/** Who settled a decision: a person's answer, a method on its own, or a rule. */
export type DecidedBy = "person" | "method" | "rule";

/** One decision of a walk, as people read it. A method's carries its decision record (for its
 * chart, evidence and promises); a rule's has only its trail step. */
export type StoryDecision = {
  round: number;
  decides: string;
  title: string;
  finding: string;
  choice: string;
  by: DecidedBy;
  decision?: FlowDecision;
};

export type WalkStory = { decisions: StoryDecision[]; runs: number; asked: number; scored: boolean };

/** A walk's trail as a story: every decision in walk order, and how often it ran, asked and
 * scored. Pure: built from records only (ADR-0065). */
export function walkStory(steps: WalkStep[], decided: FlowDecision[]): WalkStory {
  const decisions: StoryDecision[] = [];
  for (const step of steps) {
    if (!step.decides || (step.action !== "decide" && step.action !== "apply")) continue;
    // A rule compared before it applied; its apply step is the decision.
    const record = step.action === "decide" ? decided.find((d) => d.decides === step.decides) : undefined;
    const assurance = record?.assurance ?? step.assurance;
    const by: DecidedBy = step.action === "apply" ? "rule" : assurance === "confirmed" ? "person" : "method";
    decisions.push({
      round: step.round,
      decides: step.decides,
      title: record?.question ?? words(step.decides.split(".").at(-1) ?? step.decides, true),
      finding: step.reason,
      choice: record?.label ?? words(step.alternative_id ?? step.option ?? "", false),
      by,
      ...(record ? { decision: record } : {}),
    });
  }
  return {
    decisions,
    runs: steps.filter((s) => s.action === "run").length,
    asked: decisions.filter((d) => d.by === "person").length,
    scored: steps.some((s) => s.action === "score"),
  };
}

/** "column_roles" as "Column roles" (a title) or "column roles". */
function words(key: string, title: boolean): string {
  const plain = key.replaceAll("_", " ");
  return title ? plain.charAt(0).toUpperCase() + plain.slice(1) : plain;
}
