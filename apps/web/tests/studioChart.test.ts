import { describe, expect, it } from "vitest";

import { columnLayout, rowLayout } from "../src/views/charts/studioChart.ts";

describe("Flow Studio data visuals (design system §07)", () => {
  it("lays vertical bars side by side, scaled to the tallest, with a 1px gap each side", () => {
    const bars = columnLayout([4, 2, 0], { width: 330, height: 100, left: 30, bottom: 4, top: 6 });
    expect(bars.map((b) => b.x)).toEqual([31, 131, 231]);
    expect(bars.map((b) => b.w)).toEqual([98, 98, 98]);
    expect(bars[0]!.h).toBe(90);
    expect(bars[1]!.h).toBe(45);
    expect(bars[2]!.h).toBe(0);
  });

  it("scales to a given maximum, so a threshold keeps its place", () => {
    const [bar] = columnLayout([0.25], { width: 130, height: 106, left: 30, bottom: 4, top: 6, max: 0.5 });
    expect(bar!.h).toBe(48);
  });

  it("lays horizontal bars one per row, half a row thick, scaled to the longest", () => {
    const rows = rowLayout([10, 5], { width: 300, height: 48, left: 92, right: 40 });
    expect(rows.map((r) => r.w)).toEqual([168, 84]);
    expect(rows.map((r) => r.h)).toEqual([12, 12]);
    expect(rows[1]!.y).toBeGreaterThan(rows[0]!.y);
  });

  it("keeps bars thin when there are few, as the design's charts draw them", () => {
    const bars = columnLayout([1, 1], { width: 1030, height: 100, left: 30, bottom: 4, top: 6, maxBar: 24 });
    expect(bars.map((b) => b.w)).toEqual([22, 22]);
    expect(bars[1]!.x - bars[0]!.x).toBe(24);
  });
});
