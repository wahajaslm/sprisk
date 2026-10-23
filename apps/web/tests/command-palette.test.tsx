import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";

import loaded from "../../../tests/contract/loaded_table/valid/loaded-by-two-flows.json";
import { CommandPalette } from "../src/components/CommandPalette.tsx";
import { useSelection } from "../src/workbench/selection.ts";
import { PV } from "./fixtures.ts";
import { renderWithApi } from "./render.tsx";
import { server } from "./server.ts";

const table = { ...loaded, name: "standin.csv", total_rows: 600, total_columns: 4 };

const open = () => renderWithApi(<CommandPalette open onClose={() => {}} />);

describe("CommandPalette", () => {
  beforeEach(() => {
    useSelection.setState({ nav: "Objective", pipelineVersionId: PV, nodeId: undefined });
    server.use(http.get("/api/loaded_tables", () => HttpResponse.json([table])));
  });

  it("lists the open flow's steps, the operators and the loaded tables, nothing made up", async () => {
    open();

    expect(await screen.findByText("standin.csv")).toBeInTheDocument();
    expect(screen.getByText("600 × 4")).toBeInTheDocument();
    const steps = (await screen.findByText("Steps")).parentElement!;
    expect(within(steps).getByText("Linear model")).toBeInTheDocument();
    const operators = screen.getByText("Operators").parentElement!;
    expect(within(operators).getByText("sprisk.ml.linear_model@1.0.0")).toBeInTheDocument();
    for (const fake of ["umami_flavour_v2.parquet", "Missing values ≥ 20%", "Train Random Forest", "Explain missing values with Copilot"]) {
      expect(screen.queryByText(fake)).not.toBeInTheDocument();
    }
  });

  it("opens a step in the flow", async () => {
    open();

    const steps = (await screen.findByText("Steps")).parentElement!;
    await userEvent.click(await within(steps).findByText("Linear model"));

    expect(useSelection.getState()).toMatchObject({ nav: "Flow", nodeId: "model" });
  });

  it("shows why a list cannot be read, instead of quietly leaving it out", async () => {
    server.use(http.get("/api/loaded_tables", () => HttpResponse.json({ errors: [{ code: "internal", message: "disk full" }] }, { status: 500 })));
    open();

    expect(await screen.findByRole("alert")).toHaveTextContent("disk full");
  });
});
