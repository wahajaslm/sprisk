import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RowsTable } from "../src/views/RowsTable.tsx";

describe("numbers in a table", () => {
  it("show six significant digits, with the full value on hover; whole numbers and text as they are", () => {
    render(
      <RowsTable
        label="scores"
        page={{
          offset: 0,
          total_rows: 1,
          total_columns: 3,
          columns: [
            { name: "rmse", data_type: "Float64" },
            { name: "fold", data_type: "Int64" },
            { name: "model", data_type: "String" },
          ],
          rows: [{ values: ["70.94251245427581", "12345678", "3.14159265"], missing: [] }],
        }}
      />,
    );
    const rmse = screen.getByText("70.9425");
    expect(rmse).toHaveAttribute("title", "70.94251245427581");
    expect(screen.getByText("12345678")).toBeInTheDocument();
    expect(screen.getByText("3.14159265")).toBeInTheDocument();
  });
});
