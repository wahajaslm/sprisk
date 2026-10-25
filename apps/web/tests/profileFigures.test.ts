import type { DatasetProfile } from "@sprisk/contracts";
import { describe, expect, it } from "vitest";

import { correlationField, missingAndBlank, numberBins, valueBars, wordCounts } from "../src/views/datasets/profileFigures.ts";

const color = (token: string) => `var(${token})`;

const profile: DatasetProfile = {
  total_rows: 100,
  total_columns: 3,
  profiled_rows: 100,
  band_rows: 50,
  columns: [
    { name: "bmi", data_type: "Float64", missing: 3, distinct: 90, missing_by_band: [0.06, 0], histogram: { kind: "bins", bars: [{ label: "18–22", count: 40 }, { label: "22–27", count: 57 }] } },
    { name: "<b>sex</b>", data_type: "String", missing: 0, distinct: 2, missing_by_band: [0, 0], role: "category", histogram: { kind: "top_values", bars: [{ label: "F", count: 52 }, { label: "<i>M</i>", count: 40 }], other: 8 } },
    { name: "note", data_type: "String", missing: 10, blank: 25, distinct: 60, missing_by_band: [0, 0], role: "text", word_counts: { kind: "bins", bars: [{ label: "1", count: 20 }, { label: "2", count: 45 }] } },
    { name: "empty", data_type: "Float64", missing: 100, distinct: 0, missing_by_band: [1, 1] },
  ],
  correlation: { columns: ["bmi", "y", "z"], pairs: [{ column_a: "bmi", column_b: "y", pearson: -0.4, rows: 97 }] },
};

describe("dataset profile figures", () => {
  it("stacks missing and blank values per column, most first, and leaves out full columns", () => {
    const fig = missingAndBlank(profile, color);
    expect(fig).not.toBeNull();
    const [missing, blank] = fig!.data as [{ y: string[]; x: number[]; name: string; orientation: string }, { y: string[]; x: number[]; name: string }];
    expect(missing.orientation).toBe("h");
    expect(missing.y).toEqual(["empty", "note", "bmi"]);
    expect(missing.x).toEqual([100, 10, 3]);
    expect(blank).toMatchObject({ name: "Blank text", x: [0, 25, 0] });
  });

  it("draws nothing for missing values when every column is filled", () => {
    expect(missingAndBlank({ ...profile, columns: [profile.columns[1]!] }, color)).toBeNull();
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

  it("draws a category's most common values, most common on top, with the long tail as one bar", () => {
    const fig = valueBars(profile.columns[1]!, profile.profiled_rows, color);
    const [values, other] = fig.data as [{ y: string[]; x: number[] }, { y: string[]; x: number[] }];
    expect(values.y).toEqual(["F", "&lt;i&gt;M&lt;/i&gt;"]);
    expect(values.x).toEqual([52, 40]);
    expect(other).toMatchObject({ y: ["Other values"], x: [8] });
    expect(fig.layout.yaxis?.autorange).toBe("reversed");
  });

  it("draws words per value of a text column", () => {
    const [bars] = wordCounts(profile.columns[2]!, color).data as [{ x: string[]; y: number[] }];
    expect(bars).toMatchObject({ x: ["1", "2"], y: [20, 45] });
  });

  it("draws a number's bins", () => {
    const [bars] = numberBins(profile.columns[0]!, color).data as [{ x: string[]; y: number[] }];
    expect(bars).toMatchObject({ x: ["18–22", "22–27"], y: [40, 57] });
  });

  it("shows dataset text as text: markup in a column name is escaped", () => {
    const fig = missingAndBlank({ ...profile, columns: [{ ...profile.columns[1]!, missing: 1 }] }, color);
    expect((fig!.data[0] as { y: string[] }).y[0]).toBe("&lt;b&gt;sex&lt;/b&gt;");
  });
});
