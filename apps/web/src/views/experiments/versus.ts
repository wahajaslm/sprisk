import type { SelectionDecision } from "@sprisk/contracts";

/** Selection metrics where a lower score is better. */
const LOWER_IS_BETTER = new Set<SelectionDecision["metric"]>(["rmse", "expected_cost"]);

export const METRIC_WORDS: Record<SelectionDecision["metric"], string> = {
  balanced_accuracy: "balanced accuracy",
  expected_cost: "expected cost",
  rmse: "RMSE",
  weighted_f1: "weighted F1",
};

/** The pair the Compare screen opens on: the recommendation against the best other model, or
 * against the baseline when no other model was compared. */
export function defaultVersus(decision: SelectionDecision): [string, string] {
  const lower = LOWER_IS_BETTER.has(decision.metric);
  const ranked = [...decision.candidates].sort((x, y) => (lower ? x.mean - y.mean : y.mean - x.mean));
  const first = decision.winner ?? ranked[0]?.id ?? "";
  const other = ranked.find((c) => c.id !== first && c.id !== decision.baseline)?.id ?? ranked.find((c) => c.id !== first)?.id ?? first;
  return [first, other];
}

export type VersusRow = { label: string; a: number; b: number; delta: number; worse: boolean };

/** Two models' scores on the same folds, row by row: B against A, the change marked worse
 * when B scores worse, or swings more from fold to fold. */
export function versusRows(decision: SelectionDecision, a: string, b: string): VersusRow[] {
  const x = decision.candidates.find((c) => c.id === a);
  const y = decision.candidates.find((c) => c.id === b);
  if (!x || !y) return [];
  const lower = LOWER_IS_BETTER.has(decision.metric);
  const worseIf = (delta: number, higherIsBetter: boolean) => delta !== 0 && (higherIsBetter ? delta < 0 : delta > 0);
  const row = (label: string, av: number, bv: number, higherIsBetter: boolean): VersusRow => ({ label, a: av, b: bv, delta: bv - av, worse: worseIf(bv - av, higherIsBetter) });
  const worst = (s: number[]) => (lower ? Math.max(...s) : Math.min(...s));
  const best = (s: number[]) => (lower ? Math.min(...s) : Math.max(...s));
  return [
    row(`Mean ${METRIC_WORDS[decision.metric]}`, x.mean, y.mean, !lower),
    row("Spread across folds", x.spread, y.spread, false),
    row("Worst fold", worst(x.fold_scores), worst(y.fold_scores), !lower),
    row("Best fold", best(x.fold_scores), best(y.fold_scores), !lower),
  ];
}

/** On how many shared folds each model scored better. */
export function foldsWon(decision: SelectionDecision, a: string, b: string): { a: number; b: number; folds: number } {
  const x = decision.candidates.find((c) => c.id === a)?.fold_scores ?? [];
  const y = decision.candidates.find((c) => c.id === b)?.fold_scores ?? [];
  const lower = LOWER_IS_BETTER.has(decision.metric);
  const n = Math.min(x.length, y.length);
  let wonA = 0;
  let wonB = 0;
  for (let i = 0; i < n; i++) {
    const better = lower ? x[i]! < y[i]! : x[i]! > y[i]!;
    const worse = lower ? x[i]! > y[i]! : x[i]! < y[i]!;
    if (better) wonA++;
    if (worse) wonB++;
  }
  return { a: wonA, b: wonB, folds: n };
}
