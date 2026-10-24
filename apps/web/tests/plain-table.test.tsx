import { render, screen } from "@testing-library/react";
import type { TablePage } from "@sprisk/contracts";
import { describe, expect, it } from "vitest";

import { http, HttpResponse } from "msw";

import { ArtifactTable, PlainTable } from "../src/views/notebook/CellOutputs.tsx";
import { renderWithApi } from "./render.tsx";
import { server } from "./server.ts";

const page: TablePage = {
  offset: 0,
  total_rows: 600,
  total_columns: 2,
  columns: [
    { name: "designation", data_type: "String" },
    { name: "prdtypecode", data_type: "Int64" },
  ],
  rows: [
    { values: ["Jeu vidéo pro 0000", "40"], missing: [] },
    { values: ["", "10"], missing: [0] },
  ],
};

describe("a table as plain notebook output", () => {
  it("shows the column names, the values and the table's size, and no column types", () => {
    render(<PlainTable page={page} />);
    expect(screen.getByRole("columnheader", { name: "designation" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Jeu vidéo pro 0000" })).toBeInTheDocument();
    // One missing-value marker everywhere a table is shown.
    expect(screen.getByRole("cell", { name: "—" })).toHaveClass("missing");
    expect(screen.getByRole("cell", { name: "40" })).toHaveClass("num");
    expect(screen.getByText("600 rows × 2 columns")).toBeInTheDocument();
    expect(screen.queryByText("Int64")).not.toBeInTheDocument();
  });

  it("says why a saved table could not be read", async () => {
    server.use(http.get("/api/artifacts/:id/rows", () => HttpResponse.json({ errors: [{ code: "not_found", message: "gone" }] }, { status: 404 })));
    renderWithApi(<ArtifactTable artifactId="art_01JABCDEFGHJKMNPQRSTVWXYZ0" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("The table could not be read: not_found");
  });
});
