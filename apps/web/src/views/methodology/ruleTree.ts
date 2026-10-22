import type { MethodologyReviewItem, MethodologyStage } from "@sprisk/contracts";

export { STAGES } from "../../flow/decisionTree.ts";
export const stageName = (stage: MethodologyStage) => stage[0]!.toUpperCase() + stage.slice(1);

const OPEN: MethodologyReviewItem["status"][] = ["proposal", "needs_fact", "needs_run", "waiting"];

/** One review item per rule, for its node: a rule deciding several steps shows its first open
 * item, where work is needed, or its first item when none is open. */
export function reviewByRule(items: MethodologyReviewItem[]): Map<string, MethodologyReviewItem> {
  const byRule = new Map<string, MethodologyReviewItem>();
  for (const item of items) {
    const shown = byRule.get(item.rule);
    if (!shown || (!OPEN.includes(shown.status) && OPEN.includes(item.status))) byRule.set(item.rule, item);
  }
  return byRule;
}
