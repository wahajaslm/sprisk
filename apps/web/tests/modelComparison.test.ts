import { describe, expect, it } from "vitest";
import { defaultPair } from "../src/views/ModelComparison.tsx";

const decision = (metric: string, means: Record<string, number>) =>
  ({
    metric,
    baseline: "ml_dummy_baseline",
    winner: "ml_linear_model",
    candidates: Object.entries(means).map(([id, mean]) => ({ id, mean, fold_scores: [], spread: 0 })),
  }) as never;

describe("the pair shown first", () => {
  const means = { ml_dummy_baseline: 0.5, ml_linear_model: 0.6, ml_random_forest: 0.7, ml_boosted: 0.9 };

  it("pairs the recommendation with the best other model when higher is better", () => {
    expect(defaultPair(decision("weighted_f1", means))).toEqual(["ml_linear_model", "ml_boosted"]);
  });

  it.each(["rmse", "expected_cost"])("takes the lowest as best by %s", (metric) => {
    expect(defaultPair(decision(metric, means))).toEqual(["ml_linear_model", "ml_random_forest"]);
  });
});
