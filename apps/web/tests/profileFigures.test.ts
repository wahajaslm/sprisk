import type { DatasetProfile } from "@sprisk/contracts";
import { describe, expect, it } from "vitest";

import { correlationField, distributions, missingMap } from "../src/views/datasets/profileFigures.ts";

const color = (token: string) => `var(${token})`;

const profile: DatasetProfile = {
  total_rows: 100,
  total_columns: 3,
  profiled_rows: 100,
  band_rows: 50,
  columns: [
    { name: "bmi", data_type: "Float64", missing: 3, distinct: 90, missing_by_band: [0.06, 0], histogram: { kind: "bins", bars: [{ label: "18–22", count: 40 }, { label: "22–27", count: 57 }] } },
    { name: "<b>sex</b>", data_type: "String", missing: 0, distinct: 2, missing_by_band: [0, 0], histogram: { kind: "top_values", bars: [{ label: "F", count: 52 }, { label: "M", count: 48 }] } },
    { name: "empty", data_type: "Float64", missing: 100, distinct: 0, missing_by_band: [1, 1] },
  ],
  correlation: { columns: ["bmi", "y", "z"], pairs: [{ column_a: "bmi", column_b: "y", pearson: -0.4, rows: 97 }] },
};

describe("dataset profile figures", () => {
  it("draws the missing-value map as one row per column and one cell per row band, red where missing", () => {
    const fig = missingMap(profile, color);
    const [map] = fig.data as [{ type: string; z: number[][]; y: string[]; x: string[]; colorscale: [number, string][] }];
    expect(map.type).toBe("heatmap");
    expect(map.z).toEqual([[0.06, 0], [0, 0], [1, 1]]);
    expect(map.x).toEqual(["rows 1–50", "rows 51–100"]);
    expect(map.colorscale.at(-1)).toEqual([1, "var(--alert)"]);
  });

  it("draws the correlation field from -1 to 1, red for negative, with a gap where a pair has no value", () => {
    const [field] = correlationField(profile, color).data as [{ z: (number | null)[][]; zmin: number; zmax: number; colorscale: [number, string][] }];
    expect(field.z).toEqual([
      [1, -0.4, null],
      [-0.4, 1, null],
      [null, null, 1],
    ]);
    expect([field.zmin, field.zmax]).toEqual([-1, 1]);
    expect(field.colorscale[0]).toEqual([0, "var(--alert)"]);
  });

  it("draws one small bar chart per column that has values, each on its own axes", () => {
    const fig = distributions(profile, color);
    expect(fig.data).toHaveLength(2);
    expect(fig.data.map((t) => (t as { xaxis: string }).xaxis)).toEqual(["x", "x2"]);
    expect(fig.layout.grid).toMatchObject({ rows: 1, columns: 2, pattern: "independent" });
    // Declared, so the theme can colour every chart's grid.
    expect(fig.layout).toHaveProperty("yaxis2");
  });

  it("shows dataset text as text: markup in a column name is escaped", () => {
    const fig = missingMap(profile, color);
    expect((fig.data[0] as { y: string[] }).y[1]).toBe("&lt;b&gt;sex&lt;/b&gt;");
    const titles = (distributions(profile, color).layout.annotations ?? []).map((a) => a.text);
    expect(titles).toContain("&lt;b&gt;sex&lt;/b&gt;");
  });
});
