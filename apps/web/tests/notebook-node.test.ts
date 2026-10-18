import type { PipelineVersion } from "@sprisk/contracts";
import { describe, expect, it } from "vitest";

import { bindInputs, ranOutOfOrder } from "../src/notebook/node.ts";
import type { Ran } from "../src/notebook/outputs.ts";
import { pipeline } from "./fixtures.ts";

describe("linking a notebook step's inputs (ADR-0037)", () => {
  it("never links an input to a built-in step by its name, which could be a holdout", () => {
    expect(bindInputs(pipeline, ["split_test"])).toEqual({
      refused: "No step in this flow makes split_test. Pick the cells that make it too, or create their node first.",
    });
  });

  it("refuses an input two steps make, rather than guess which one the session used", () => {
    const twice: PipelineVersion = {
      ...pipeline,
      nodes: [
        { id: "a", operator: "sprisk.code.python@2.0.0", params: { source: "df = 1", outputs: ["df"] } },
        { id: "b", operator: "sprisk.code.python@2.0.0", params: { source: "df = 2", outputs: ["df"] } },
      ],
    };
    expect(bindInputs(twice, ["df"])).toEqual({ refused: "Steps a and b both make df. Rename one, or pick the cells that make it too." });
  });

});

describe("cells run out of order", () => {
  const cells = [
    { id: "a", kind: "code" as const, source: "x = 1" },
    { id: "b", kind: "code" as const, source: "y = x + 1" },
  ];
  const ran = (n: number): Ran => ({ code: "", result: { status: "ok", execution_count: n, outputs: [] } });

  it("is when a lower cell ran before one above it", () => {
    expect(ranOutOfOrder(cells, { a: ran(3), b: ran(2) })).toBe(true);
    expect(ranOutOfOrder(cells, { a: ran(1), b: ran(2) })).toBe(false);
  });
});
