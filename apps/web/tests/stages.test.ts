import { describe, expect, it } from "vitest";

import { figurePortOf } from "../src/flow/stages.ts";
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
