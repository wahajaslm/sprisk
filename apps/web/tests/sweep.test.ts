import { describe, expect, it } from "vitest";

import { parallelLines, searchSpace, topTrials } from "../src/views/experiments/sweep.ts";

const trial = (node_id: string, settings: Record<string, unknown>) => ({ node_id, candidate: "ml_random_forest", settings });

const trials = [
  trial("t1", { n_estimators: 100, max_depth: 4, criterion: "gini" }),
  trial("t2", { n_estimators: 400, max_depth: 16, criterion: "entropy" }),
  trial("t3", { n_estimators: 800, max_depth: 8, criterion: "gini" }),
];
const scores = new Map([
  ["t1", 0.8],
  ["t2", 0.9],
  ["t3", 0.85],
]);

describe("a study's search, as the design's Sweep (ADR-0052, ADR-0065)", () => {
  it("names each setting's range when it is a number, and its values otherwise", () => {
    expect(searchSpace(trials)).toEqual([
      { setting: "n_estimators", text: "100 – 800" },
      { setting: "max_depth", text: "4 – 16" },
      { setting: "criterion", text: "gini, entropy" },
    ]);
  });

  it("draws each trial as a line across its settings and its score, scaled 0 to 1, and marks the best", () => {
    const { axes, lines, best } = parallelLines(trials, scores, "accuracy");
    expect(axes).toEqual(["n_estimators", "max_depth", "criterion", "accuracy"]);
    expect(lines[0]).toEqual([0, 0, 0, 0]);
    expect(lines[1]).toEqual([300 / 700, 1, 1, 1]);
    expect(best).toBe(1);
  });

  it("leaves out a trial with no score yet", () => {
    const { lines } = parallelLines(trials, new Map([["t1", 0.8]]), "accuracy");
    expect(lines).toHaveLength(1);
  });

  it("lists the best trials first, with their settings and score", () => {
    expect(topTrials(trials, scores, 2).map((t) => t.node_id)).toEqual(["t2", "t3"]);
  });
});
