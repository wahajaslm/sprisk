import type { SelectionDecision } from "@sprisk/contracts";
import { describe, expect, it } from "vitest";

import winner from "../../../tests/contract/selection_decision/valid/winner.json";
import { defaultVersus, foldsWon, versusRows } from "../src/views/experiments/versus.ts";

const decision = winner as SelectionDecision;

describe("two models on the same folds (design: Compare)", () => {
  it("compares the recommended model with the best other one by default, the baseline when there is none", () => {
    expect(defaultVersus(decision)).toEqual(["ml_linear_model", "ml_random_forest"]);
    const two = { ...decision, candidates: decision.candidates.filter((c) => c.id !== "ml_random_forest") };
    expect(defaultVersus(two)).toEqual(["ml_linear_model", "ml_dummy_baseline"]);
  });

  it("puts their mean, spread, worst and best fold side by side with the change, worse marked", () => {
    const rows = versusRows(decision, "ml_random_forest", "ml_linear_model");
    const mean = rows.find((r) => r.label.startsWith("Mean"))!;
    const a = decision.candidates.find((c) => c.id === "ml_random_forest")!;
    const b = decision.candidates.find((c) => c.id === "ml_linear_model")!;
    expect([mean.a, mean.b]).toEqual([a.mean, b.mean]);
    expect(mean.delta).toBeCloseTo(b.mean - a.mean);
    expect(mean.worse).toBe(b.mean < a.mean);
    expect(rows.map((r) => r.label)).toEqual(["Mean balanced accuracy", "Spread across folds", "Worst fold", "Best fold"]);
  });

  it("calls a larger spread worse: the model is less steady", () => {
    const rows = versusRows(decision, "ml_dummy_baseline", "ml_linear_model");
    const spread = rows.find((r) => r.label === "Spread across folds")!;
    expect(spread.worse).toBe(spread.b > spread.a);
  });

  it("counts the folds each model won, paired fold by fold", () => {
    const a = decision.candidates.find((c) => c.id === "ml_linear_model")!.fold_scores;
    const b = decision.candidates.find((c) => c.id === "ml_dummy_baseline")!.fold_scores;
    expect(foldsWon(decision, "ml_linear_model", "ml_dummy_baseline")).toEqual({ a: a.filter((v, i) => v > b[i]!).length, b: a.filter((v, i) => v < b[i]!).length, folds: a.length });
  });

  it("compares the recommendation with the baseline when the best other model scored the same on every fold", () => {
    const same = { ...decision, candidates: decision.candidates.map((c) => (c.id === "ml_random_forest" ? { ...c, fold_scores: decision.candidates.find((x) => x.id === "ml_linear_model")!.fold_scores } : c)) };
    expect(defaultVersus(same)).toEqual(["ml_linear_model", "ml_dummy_baseline"]);
  });
});
