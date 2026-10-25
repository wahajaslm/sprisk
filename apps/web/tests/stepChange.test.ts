import type { DatasetProfile } from "@sprisk/contracts";
import { describe, expect, it } from "vitest";

import { columnsChange, missingBeforeAfter, rowsInOut } from "../src/views/inspector/stepChange.ts";

const color = (token: string) => `var(${token})`;

const table = (rows: number, columns: [string, number][]): DatasetProfile => ({
  total_rows: rows,
  total_columns: columns.length,
  profiled_rows: rows,
  band_rows: 0,
  columns: columns.map(([name, missing]) => ({ name, data_type: "Float64", missing, distinct: 1, missing_by_band: [] })),
  correlation: { columns: [], pairs: [] },
});

describe("what a step did, from the tables it read and wrote (ADR-0065)", () => {
  it("draws rows in and rows out, one bar per table, inputs first", () => {
    const fig = rowsInOut([{ port: "data", profile: table(600, []) }], [{ port: "train", profile: table(484, []) }, { port: "test", profile: table(116, []) }], color);
    const [bars] = fig.data as [{ x: string[]; y: number[]; marker: { color: string[] } }];
    expect(bars.x).toEqual(["in · data", "out · train", "out · test"]);
    expect(bars.y).toEqual([600, 484, 116]);
    expect(fig.layout.title).toEqual({ text: "Rows in and out" });
  });

  it("names the columns a step added and the ones it removed", () => {
    const change = columnsChange(table(10, [["a", 0], ["id", 0], ["text", 0]]), table(10, [["a", 0], ["text", 0], ["words", 0]]));
    expect(change).toEqual({ added: ["words"], removed: ["id"] });
  });

  it("draws missing values before and after for the columns both tables hold that had any", () => {
    const fig = missingBeforeAfter(table(100, [["age", 12], ["bmi", 0], ["id", 3]]), table(100, [["age", 0], ["bmi", 0]]), color);
    expect(fig).not.toBeNull();
    const [before, after] = fig!.data as [{ y: string[]; x: number[]; name: string }, { x: number[]; name: string }];
    expect(before).toMatchObject({ name: "Before", y: ["age"], x: [12] });
    expect(after).toMatchObject({ name: "After", x: [0] });
  });

  it("draws no missing-value chart when neither table has a gap", () => {
    expect(missingBeforeAfter(table(5, [["a", 0]]), table(5, [["a", 0]]), color)).toBeNull();
  });
});
