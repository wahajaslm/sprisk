import { describe, expect, it } from "vitest";

import { figurePortOf, stepLabel } from "../src/flow/stages.ts";
import { notebookOperator, operators } from "./fixtures.ts";

const byId = (id: string) => operators.find((o) => o.id === id)!;

describe("where a step's figures are", () => {
  it("is a built-in step's first figure port", () => {
    expect(figurePortOf(byId("sprisk.profile.chart@1.0.0"))).toBe("chart");
  });

  it("is a code step's display, which holds what its code drew", () => {
    expect(figurePortOf(notebookOperator)).toBe("display");
  });

  it("is nowhere for a step that draws nothing", () => {
    expect(figurePortOf(byId("sprisk.profile.summarize@1.0.0"))).toBeUndefined();
  });
});

describe("a step's label (ADR-0055)", () => {
  it("is its kind as the title and what it is about, from its id, below", () => {
    expect(stepLabel({ id: "credit_amount_by_risk", operator: notebookOperator.id, params: {}, title: "Box plot" })).toEqual({ title: "Box plot", subject: "credit amount by risk" });
  });

  it("takes a ready-made step's kind from its operator", () => {
    expect(stepLabel({ id: "split", operator: "sprisk.validation.random_split@1.0.0", params: {} })).toEqual({ title: "Random split", subject: "split" });
  });

  it("calls a code step with no title Python code", () => {
    expect(stepLabel({ id: "rate", operator: notebookOperator.id, params: {} }).title).toBe("Python code");
  });
});
