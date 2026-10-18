import type { Dataset, DatasetProfile } from "@sprisk/contracts";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it } from "vitest";

import { DatasetsPage } from "../src/views/datasets/DatasetsPage.tsx";
import { useSelection } from "../src/workbench/selection.ts";
import { PV, RUN, loadOutputs } from "./fixtures.ts";
import { renderWithApi } from "./render.tsx";
import { server } from "./server.ts";

const iris: Dataset = {
  name: "iris.csv",
  operator: "sprisk.io.file_source@1.0.0",
  artifact: loadOutputs[0]!.artifact,
  total_rows: 120,
  total_columns: 3,
  used_by: [{ pipeline_version_id: PV, run_id: RUN, node_id: "load" }],
};
const penguins: Dataset = {
  ...iris,
  name: "penguins.csv",
  artifact: { ...iris.artifact, id: "art_01JABCDEFGHJKMNPQRSTVWXY55" },
  total_rows: 344,
};

const profile: DatasetProfile = {
  total_rows: 120,
  total_columns: 3,
  band_rows: 3,
  columns: [
    { name: "sepal_length", data_type: "Float64", missing: 6, distinct: 35, missing_by_band: [0, 0.5], histogram: { kind: "bins", bars: [{ label: "4.3–5", count: 50 }, { label: "5–7.9", count: 64 }] } },
    { name: "species", data_type: "String", missing: 0, distinct: 3, missing_by_band: [0, 0], histogram: { kind: "top_values", bars: [{ label: "setosa", count: 40 }] } },
    { name: "petal_width", data_type: "Float64", missing: 0, distinct: 22, missing_by_band: [0, 0], histogram: { kind: "bins", bars: [{ label: "0.1–2.5", count: 120 }] } },
  ],
  correlation: { columns: ["sepal_length", "petal_width"], values: [[1, 0.82], [0.82, 1]] },
};

/** Serves the datasets and a profile; returns every path the page asked for. */
function serve(datasets: () => Response = () => HttpResponse.json([iris, penguins]), profiled: () => Response = () => HttpResponse.json(profile)) {
  const asked: string[] = [];
  server.events.on("request:start", ({ request }) => {
    asked.push(new URL(request.url).pathname);
  });
  server.use(http.get("/api/datasets", datasets), http.get("/api/artifacts/:id/profile", profiled));
  renderWithApi(<DatasetsPage />);
  return asked;
}

afterEach(() => server.events.removeAllListeners());

describe("datasets", () => {
  it("lists each table the flows load, with its rows, columns and the steps that load it", async () => {
    serve();
    const list = await screen.findByRole("table", { name: "Datasets" });
    const row = within(list).getByRole("row", { name: /^iris\.csv/ });
    expect(row).toHaveTextContent("120");
    expect(row).toHaveTextContent("3");
    expect(row).toHaveTextContent("iris.csv · load");
    expect(within(list).getByRole("row", { name: /^penguins\.csv/ })).toHaveTextContent("344");
  });

  it("filters the list by name", async () => {
    serve();
    await userEvent.type(await screen.findByRole("searchbox", { name: "Filter datasets" }), "peng");
    const list = screen.getByRole("table", { name: "Datasets" });
    expect(within(list).queryByRole("row", { name: /^iris\.csv/ })).toBeNull();
    expect(within(list).getByRole("row", { name: /^penguins\.csv/ })).toBeInTheDocument();
  });

  it("profiles the first dataset: each column's type, missing share and distinct count", async () => {
    serve();
    const columns = await screen.findByRole("table", { name: "Columns of iris.csv" });
    const sepal = within(columns).getByRole("row", { name: /sepal_length/ });
    expect(sepal).toHaveTextContent("Float64");
    expect(sepal).toHaveTextContent("5%");
    expect(sepal).toHaveTextContent("35");
  });

  it("draws where values are missing, how numeric columns correlate, and each column's distribution", async () => {
    serve();
    expect(await screen.findByRole("img", { name: "Missing values by row band" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Correlation field (Pearson)" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Distributions" })).toBeInTheDocument();
  });

  it("says the profile covers every row, including any a flow holds out", async () => {
    serve();
    expect(await screen.findByText(/including rows a flow holds out/)).toBeInTheDocument();
  });

  it("shows another dataset's profile when it is picked", async () => {
    serve();
    await userEvent.click(await screen.findByRole("button", { name: "penguins.csv" }));
    expect(await screen.findByRole("table", { name: "Columns of penguins.csv" })).toBeInTheDocument();
  });

  it("never asks for a table's rows or content: only the list and the profile", async () => {
    const asked = serve();
    await screen.findByRole("img", { name: "Distributions" });
    expect(asked.every((p) => p === "/api/datasets" || p.endsWith("/profile") || p === "/api/pipeline_versions")).toBe(true);
  });

  it("opens the step that loads it in the flow", async () => {
    serve();
    await userEvent.click(await screen.findByRole("button", { name: "Open iris.csv in Flow" }));
    expect(useSelection.getState()).toMatchObject({ nav: "Flow", pipelineVersionId: PV, runId: RUN, nodeId: "load" });
  });

  it("says when no flow has loaded a table yet", async () => {
    serve(() => HttpResponse.json([]));
    expect(await screen.findByText(/No datasets yet/)).toBeInTheDocument();
  });

  it("shows why the list or a profile could not be read", async () => {
    serve(undefined, () => HttpResponse.json({ errors: [{ code: "profile_timeout", message: "took too long" }] }, { status: 422 }));
    expect(await screen.findByRole("alert")).toHaveTextContent("profile_timeout");
  });
});
