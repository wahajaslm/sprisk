import type { DatasetProfile, LoadedTable } from "@sprisk/contracts";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it } from "vitest";

import { DatasetsPage } from "../src/views/datasets/DatasetsPage.tsx";
import { useSelection } from "../src/workbench/selection.ts";
import { PV, RUN, loadOutputs } from "./fixtures.ts";
import { renderWithApi } from "./render.tsx";
import { server } from "./server.ts";

const iris: LoadedTable = {
  name: "iris.csv",
  operator: "sprisk.io.file_source@1.0.0",
  artifact: loadOutputs[0]!.artifact,
  total_rows: 120,
  total_columns: 3,
  used_by: [{ pipeline_version_id: PV, run_id: RUN, node_id: "load" }],
};
const penguins: LoadedTable = {
  ...iris,
  name: "penguins.csv",
  artifact: { ...iris.artifact, id: "art_01JABCDEFGHJKMNPQRSTVWXY55" },
  total_rows: 344,
};

const profile: DatasetProfile = {
  total_rows: 120,
  total_columns: 3,
  profiled_rows: 120,
  band_rows: 3,
  columns: [
    { name: "sepal_length", data_type: "Float64", missing: 6, distinct: 35, missing_by_band: [0, 0.5], histogram: { kind: "bins", bars: [{ label: "4.3–5", count: 50 }, { label: "5–7.9", count: 64 }] } },
    { name: "species", data_type: "String", missing: 0, distinct: 3, missing_by_band: [0, 0], histogram: { kind: "top_values", bars: [{ label: "setosa", count: 40 }] } },
    { name: "petal_width", data_type: "Float64", missing: 0, distinct: 22, missing_by_band: [0, 0], histogram: { kind: "bins", bars: [{ label: "0.1–2.5", count: 120 }] } },
  ],
  correlation: { columns: ["sepal_length", "petal_width"], pairs: [{ column_a: "sepal_length", column_b: "petal_width", pearson: 0.82, rows: 114 }] },
};

/** Serves the datasets and a profile; returns every path the page asked for. */
function serve(datasets: () => Response = () => HttpResponse.json([iris, penguins]), profiled: () => Response = () => HttpResponse.json(profile)) {
  const asked: string[] = [];
  server.events.on("request:start", ({ request }) => {
    asked.push(new URL(request.url).pathname);
  });
  server.use(http.get("/api/loaded_tables", datasets), http.get("/api/artifacts/:id/profile", profiled));
  renderWithApi(<DatasetsPage />);
  return asked;
}

/** The page opens on Preview; profile tests open the Profile tab first. */
async function openProfile() {
  await userEvent.click(await screen.findByRole("tab", { name: "Profile" }));
}

afterEach(() => server.events.removeAllListeners());

describe("datasets", () => {
  it("counts the distinct flows that use a table, and 0 when none does", async () => {
    const twice: LoadedTable = { ...iris, used_by: [iris.used_by[0]!, { ...iris.used_by[0]!, node_id: "data" }] };
    serve(() => HttpResponse.json([twice]));
    expect(await screen.findByText("1 flow")).toBeInTheDocument();
  });

  it("says 0 flows for a table no flow uses", async () => {
    serve(() => HttpResponse.json([{ ...iris, used_by: [] }]));
    expect(await screen.findByText("0 flows")).toBeInTheDocument();
  });

  it("lists each table the flows load, with its rows, columns and the steps that load it", async () => {
    serve();
    const list = await screen.findByRole("list", { name: "Dataset list" });
    const item = within(list).getByRole("button", { name: /^iris\.csv/ });
    expect(item).toHaveTextContent("120 rows");
    expect(item).toHaveTextContent("3 columns");
    expect(within(await screen.findByRole("region", { name: "iris.csv" })).getByText(/iris\.csv · load/)).toBeInTheDocument();
    expect(within(list).getByRole("button", { name: /^penguins\.csv/ })).toHaveTextContent("344 rows");
  });

  it("filters the list by name", async () => {
    serve();
    await userEvent.type(await screen.findByRole("searchbox", { name: "Filter datasets" }), "peng");
    const list = screen.getByRole("list", { name: "Dataset list" });
    expect(within(list).queryByRole("button", { name: /^iris\.csv/ })).toBeNull();
    expect(within(list).getByRole("button", { name: /^penguins\.csv/ })).toBeInTheDocument();
  });

  it("profiles the first dataset: each column's type, missing share and distinct count", async () => {
    serve();
    await openProfile();
    const columns = await screen.findByRole("table", { name: "Columns of iris.csv" });
    const sepal = within(columns).getByRole("row", { name: /sepal_length/ });
    expect(sepal).toHaveTextContent("Float64");
    expect(sepal).toHaveTextContent("5%");
    expect(sepal).toHaveTextContent("35");
  });

  it("draws where values are missing, how numeric columns correlate, and each column's distribution", async () => {
    const three = { ...profile, correlation: { ...profile.correlation, columns: ["sepal_length", "petal_width", "petal_length"] } };
    serve(undefined, () => HttpResponse.json(three));
    await openProfile();
    expect(await screen.findByRole("img", { name: "Missing values by row band" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Correlation field (Pearson)" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Distributions" })).toBeInTheDocument();
  });

  it("says the profile includes held-out rows and is for looking, not for choosing", async () => {
    serve();
    await openProfile();
    expect(await screen.findByText(/including held-out test rows/)).toHaveTextContent("not to choose features, transforms or models");
  });

  it("says when a large table was profiled only in part", async () => {
    serve(undefined, () => HttpResponse.json({ ...profile, total_rows: 5_000_000, profiled_rows: 1_000_000, total_columns: 250 }));
    await openProfile();
    expect(await screen.findByText(/first 1,000,000 of 5,000,000 rows/)).toBeInTheDocument();
    expect(screen.getByText(/first 3 of 250 columns/)).toBeInTheDocument();
  });

  it("shows another dataset's profile when it is picked", async () => {
    serve();
    await userEvent.click(await screen.findByRole("button", { name: /^penguins\.csv/ }));
    await openProfile();
    expect(await screen.findByRole("table", { name: "Columns of penguins.csv" })).toBeInTheDocument();
  });

  it("asks for one page of rows for the preview, and no rows for the profile (ADR-0038)", async () => {
    const asked = serve();
    await screen.findByRole("table", { name: "First rows of iris.csv" });
    await openProfile();
    await screen.findByRole("img", { name: "Distributions" });
    const rows = asked.filter((p) => p.endsWith("/rows"));
    expect(rows).toEqual([`/api/artifacts/${iris.artifact.id}/rows`]);
    expect(asked.every((p) => p === "/api/loaded_tables" || p.endsWith("/profile") || p.endsWith("/rows") || p === "/api/pipeline_versions")).toBe(true);
  });

  it("opens on a preview of the first rows, numbers on the right and a missing value as a dash", async () => {
    let limit: string | null = null;
    server.use(http.get("/api/artifacts/:id/rows", ({ request }) => {
      limit = new URL(request.url).searchParams.get("limit");
      return HttpResponse.json({ offset: 0, total_rows: 120, total_columns: 2,
        columns: [{ name: "species", data_type: "String" }, { name: "petal_width", data_type: "Float64" }],
        rows: [{ values: ["setosa", "0.2"], missing: [] }, { values: ["", ""], missing: [1] }] });
    }));
    serve();
    const preview = await screen.findByRole("table", { name: "First rows of iris.csv" });
    expect(screen.getByRole("tab", { name: "Preview" })).toHaveAttribute("aria-selected", "true");
    expect(limit).toBe("50");
    expect(within(preview).getByRole("cell", { name: "0.2" })).toHaveClass("ds-num");
    expect(within(preview).getByRole("cell", { name: "—" })).toBeInTheDocument();
    expect(screen.getByText(/First 2 of 120 rows/)).toBeInTheDocument();
  });

  it("says no column has missing values instead of drawing an empty chart", async () => {
    const full = { ...profile, columns: profile.columns.map((c) => ({ ...c, missing: 0 })) };
    serve(undefined, () => HttpResponse.json(full));
    await openProfile();
    expect(await screen.findByText("No column has missing values.")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Columns missing most" })).not.toBeInTheDocument();
  });

  it("draws no correlation field for fewer than three numeric columns", async () => {
    serve();
    await openProfile();
    expect(await screen.findByRole("img", { name: "Distributions" })).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "Correlation field (Pearson)" })).not.toBeInTheDocument();
  });

  it("opens the step that loads it in the flow", async () => {
    serve();
    await userEvent.click(await screen.findByRole("button", { name: "Open in flow" }));
    expect(useSelection.getState()).toMatchObject({ nav: "Flow", pipelineVersionId: PV, runId: RUN, nodeId: "load" });
  });

  it("has Preview, Profile and Lineage tabs; Lineage lists each step loading the table", async () => {
    serve();
    expect((await screen.findAllByRole("tab")).map((t) => t.textContent)).toEqual(["Preview", "Profile", "Lineage"]);
    await userEvent.click(screen.getByRole("tab", { name: "Lineage" }));
    const lineage = await screen.findByRole("list", { name: "Lineage" });
    expect(lineage).toHaveTextContent(/iris\.csv.*load/);
    await userEvent.click(within(lineage).getByRole("button", { name: "Open" }));
    expect(useSelection.getState()).toMatchObject({ nav: "Flow", pipelineVersionId: PV, runId: RUN, nodeId: "load" });
  });

  it("says so when no flow loads the table any more", async () => {
    serve(() => HttpResponse.json([{ ...iris, used_by: [] }]));
    await userEvent.click(await screen.findByRole("tab", { name: "Lineage" }));
    expect(await screen.findByText("No flow loads this table yet.")).toBeInTheDocument();
  });

  it("draws each column's missing share and lists the columns missing most, red from 20%", async () => {
    const gappy = { ...profile, columns: [{ ...profile.columns[0]!, missing: 30 }, profile.columns[1]!, { ...profile.columns[2]!, missing: 6 }] };
    serve(undefined, () => HttpResponse.json(gappy));
    await openProfile();
    const worst = await screen.findByRole("list", { name: "Columns missing most" });
    const rows = within(worst).getAllByRole("listitem");
    expect(rows.map((r) => r.textContent)).toEqual(["sepal_length25%", "petal_width5%", "species0%"]);
    expect(rows[0]).toHaveClass("warn");
    expect(rows[1]).not.toHaveClass("warn");
  });

  it("marks a column's missing share red only from 20%", async () => {
    const gappy = { ...profile, columns: [{ ...profile.columns[0]!, missing: 30 }, profile.columns[1]!, { ...profile.columns[2]!, missing: 6 }] };
    serve(undefined, () => HttpResponse.json(gappy));
    await openProfile();
    const columns = await screen.findByRole("table", { name: "Columns of iris.csv" });
    const bar = (name: string) => within(within(columns).getByRole("row", { name: new RegExp(name) })).getByTestId("missing");
    expect(bar("sepal_length")).toHaveClass("warn");
    expect(bar("petal_width")).not.toHaveClass("warn");
  });

  it("says when no flow has loaded a table yet", async () => {
    serve(() => HttpResponse.json([]));
    expect(await screen.findByText(/No datasets yet/)).toBeInTheDocument();
  });

  it("shows why the list could not be read", async () => {
    serve(() => HttpResponse.json({ errors: [{ code: "not_found", message: "gone" }] }, { status: 500 }));
    expect(await screen.findByRole("alert")).toHaveTextContent("not_found");
  });

  it("shows why a profile could not be read", async () => {
    serve(undefined, () => HttpResponse.json({ errors: [{ code: "profile_timeout", message: "took too long" }] }, { status: 422 }));
    await openProfile();
    expect(await screen.findByRole("alert")).toHaveTextContent("profile_timeout");
  });
});
