import { describe, expect, it } from "vitest";

import { keepDragged } from "../src/flow/layout.ts";

describe("steps on the canvas", () => {
  const computed = [
    { id: "load", position: { x: 0, y: 0 } },
    { id: "split", position: { x: 200, y: 0 } },
  ];
  const shown = [
    { id: "load", position: { x: 50, y: 300 } },
    { id: "split", position: { x: 999, y: 999 } },
  ];

  it("a dragged step stays where it was dropped; the others follow the layout", () => {
    expect(keepDragged(computed, shown, new Set(["load"]))).toEqual([
      { id: "load", position: { x: 50, y: 300 } },
      { id: "split", position: { x: 200, y: 0 } },
    ]);
  });

  it("with nothing dragged (Tidy), every step is where the layout puts it", () => {
    expect(keepDragged(computed, shown, new Set())).toEqual(computed);
  });
});
