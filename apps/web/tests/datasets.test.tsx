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
  total_columns: 4,
  profiled_rows: 120,
  band_rows: 3,
  columns: [
    { name: "sepal_length", data_type: "Float64", role: "number", missing: 6, distinct: 35, missing_by_band: [0, 0.5], quartiles: { min: 4.3, q1: 5.1, median: 5.8, q3: 6.4, max: 7.9 }, mean: 5.843, std: 0.83, skewness: 0.31, fences: { low: 3.15, high: 7.6 }, outliers: 2, histogram: { kind: "bins", bars: [{ label: "4.3–5", count: 50, lower: 4.3, upper: 5 }, { label: "5–7.9", count: 64, lower: 5, upper: 7.9 }] } },
    { name: "species", data_type: "String", role: "category", missing: 0, distinct: 3, missing_by_band: [0, 0], histogram: { kind: "top_values", bars: [{ label: "setosa", count: 40 }, { label: "virginica", count: 40 }], other: 40 } },
    { name: "petal_width", data_type: "Float64", role: "number", missing: 0, distinct: 22, missing_by_band: [0, 0], histogram: { kind: "bins", bars: [{ label: "0.1–2.5", count: 120 }] } },
    { name: "note", data_type: "String", role: "text", missing: 0, blank: 12, distinct: 90, missing_by_band: [0, 0], word_counts: { kind: "bins", bars: [{ label: "2", count: 100 }] }, histogram: { kind: "top_values", bars: [{ label: "same note", count: 4 }, { label: "once", count: 1 }] } },
  ],
  correlation: { columns: ["sepal_length", "petal_width"], pairs: [{ column_a: "sepal_length", column_b: "petal_width", pearson: 0.82, rows: 114 }] },
  findings: [
    { level: "warning", topic: "blank", column: "note", text: "note holds blank text in 12 of 120 rows (10%): empty, not missing, so an imputer will not see it." },
    { level: "note", topic: "repeated_values", column: "note", text: "4 of 108 rows of note share their value with another row; the most repeated value appears 4 times.", example: "same note" },
  ],
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

  it("opens on Explore and heads each column with its type, missing share and distribution", async () => {
    serve();
    expect(await screen.findByRole("tab", { name: "Explore" })).toHaveAttribute("aria-selected", "true");
    const table = await screen.findByRole("table", { name: "Rows of iris.csv" });
    const header = within(table).getByRole("columnheader", { name: /sepal_length/ });
    expect(header).toHaveTextContent("Float64 · 5% missing");
    expect(await within(header).findByRole("img", { name: "Distribution of sepal_length" })).toBeInTheDocument();
  });

  it("shows a page of rows, numbers on the right, a missing value as a dash and a value outside the fences in red", async () => {
    let limit: string | null = null;
    server.use(http.get("/api/artifacts/:id/rows", ({ request }) => {
      limit = new URL(request.url).searchParams.get("limit");
      return HttpResponse.json({ offset: 0, total_rows: 120, total_columns: 2,
        columns: [{ name: "species", data_type: "String" }, { name: "sepal_length", data_type: "Float64" }],
        rows: [{ values: ["setosa", "5.2"], missing: [] }, { values: ["", ""], missing: [1] }, { values: ["virginica", "19.5"], missing: [] }] });
    }));
    serve();
    const table = await screen.findByRole("table", { name: "Rows of iris.csv" });
    expect(limit).toBe("50");
    expect(within(table).getByRole("cell", { name: "5.2" })).toHaveClass("num");
    expect(within(table).getByRole("cell", { name: "5.2" })).not.toHaveClass("warn");
    expect(within(table).getByRole("cell", { name: "19.5" })).toHaveClass("warn");
    expect(within(table).getByRole("cell", { name: "—" })).toBeInTheDocument();
    expect(screen.getByText(/Showing rows 1–3 of 120\./)).toBeInTheDocument();
  });

  it("pages through the rows and jumps to the row a person types", async () => {
    serve();
    const rows = await screen.findByRole("region", { name: "Look at the rows" });
    expect(await within(rows).findByText(/Showing rows 1–50 of 120/)).toBeInTheDocument();
    await userEvent.click(within(rows).getByRole("button", { name: "Next rows" }));
    expect(await within(rows).findByText(/Showing rows 51–100 of 120/)).toBeInTheDocument();
    expect(within(rows).getByRole("cell", { name: "51" })).toBeInTheDocument();
    await userEvent.type(within(rows).getByRole("spinbutton", { name: "Go to row" }), "101{Enter}");
    expect(await within(rows).findByText(/Showing rows 101–120 of 120/)).toBeInTheDocument();
    expect(within(rows).getByRole("button", { name: "Next rows" })).toBeDisabled();
  });

  it("reads one column: its distribution with the fences, a box plot and its numbers; a header click picks it", async () => {
    serve();
    const read = await screen.findByRole("region", { name: "Read one column" });
    expect(within(read).getByRole("heading", { name: "sepal_length" })).toBeInTheDocument();
    expect(within(read).getByText("1 of 4")).toBeInTheDocument();
    expect(within(read).getByRole("img", { name: "Distribution of sepal_length" })).toBeInTheDocument();
    expect(within(read).getByRole("img", { name: "Box plot of sepal_length" })).toBeInTheDocument();
    expect(within(read).getByText("Upper fence 7.6")).toBeInTheDocument();
    const stats = within(read).getByRole("list", { name: "Numbers of sepal_length" });
    expect(stats).toHaveTextContent("Mean5.84");
    expect(stats).toHaveTextContent("Median5.8");
    expect(stats).toHaveTextContent("Outliers2");
    expect(read).toHaveTextContent("2 values fall outside the IQR fences.");
    await userEvent.click(within(read).getByRole("button", { name: "Next" }));
    expect(within(read).getByRole("heading", { name: "species" })).toBeInTheDocument();
    expect(within(read).getByRole("list", { name: "Most common values of species" })).toHaveTextContent("setosa40 · 33.3%");
    const table = screen.getByRole("table", { name: "Rows of iris.csv" });
    await userEvent.click(within(table).getByRole("button", { name: /sepal_length/ }));
    expect(within(read).getByRole("heading", { name: "sepal_length" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Read note" }));
    expect(within(read).getByRole("heading", { name: "note" })).toBeInTheDocument();
    expect(within(read).getByRole("img", { name: "Words per value in note" })).toBeInTheDocument();
  });

  it("puts every column on one axis: missing share, where the gaps sit, and outliers, with what goes together", async () => {
    serve(undefined, () => HttpResponse.json({ ...profile, rows_with_gap: 40, co_missing: [{ column_a: "sepal_length", column_b: "note", rows: 6 }] }));
    const gaps = await screen.findByRole("region", { name: "Check what's missing or extreme" });
    expect(within(gaps).getByRole("img", { name: "Missing share per column" })).toBeInTheDocument();
    expect(within(gaps).getByRole("img", { name: "Missing cells along the rows" })).toBeInTheDocument();
    expect(within(gaps).getByRole("list", { name: "Outliers per column" })).toHaveTextContent("2");
    expect(gaps).toHaveTextContent("6 rows miss both sepal_length and note.");
    expect(gaps).toHaveTextContent("40 of 120 rows have at least one gap.");
  });

  it("relates the measured numbers to each other: the strongest pairs and a correlation matrix", async () => {
    serve(undefined, () => HttpResponse.json({ ...profile, correlation: { ...profile.correlation, columns: ["sepal_length", "petal_width", "petal_length"] } }));
    const relate = await screen.findByRole("region", { name: "Relate columns to each other" });
    expect(within(relate).getByRole("list", { name: "Strongest pairs" })).toHaveTextContent("sepal_length · petal_width+0.82");
    expect(within(relate).getByRole("img", { name: "Correlation matrix" })).toBeInTheDocument();
    expect(within(relate).getByRole("list", { name: "Moves most with sepal_length" })).toHaveTextContent("petal_width+0.82");
  });

  it("draws no fences for an identifier: its spread is its numbering", async () => {
    const ids = { ...profile, columns: profile.columns.map((c) => (c.name === "sepal_length" ? { ...c, role: "identifier" as const } : c)) };
    serve(undefined, () => HttpResponse.json(ids));
    const table = await screen.findByRole("table", { name: "Rows of iris.csv" });
    await screen.findByRole("region", { name: "Read one column" });
    expect(within(table).getAllByRole("cell").filter((c) => c.classList.contains("warn"))).toHaveLength(0);
    expect(screen.getByRole("list", { name: "Outliers per column" })).not.toHaveTextContent("2");
  });

  it("leaves out the correlations when fewer than two numbers vary", async () => {
    serve(undefined, () => HttpResponse.json({ ...profile, correlation: { columns: [], pairs: [] } }));
    await screen.findByRole("region", { name: "Read one column" });
    expect(screen.queryByRole("region", { name: "Relate columns to each other" })).toBeNull();
  });

  it("lists what stands out, warnings first, with an example from the data", async () => {
    serve();
    const stands = await screen.findByRole("region", { name: "What stands out" });
    const rows = within(stands).getAllByRole("listitem");
    expect(rows[0]).toHaveClass("warn");
    expect(rows[0]).toHaveTextContent("Blank text");
    expect(rows[0]).toHaveTextContent("note holds blank text in 12 of 120 rows");
    expect(rows[1]).toHaveTextContent("Example: same note");
  });

  it("puts the table's numbers in the Info dock, not in a row under the header", async () => {
    serve(undefined, () => HttpResponse.json({ ...profile, duplicate_rows: 3 }));
    expect(await screen.findByText("Duplicate rows")).toBeInTheDocument();
    expect(screen.getByText("Empty cells")).toBeInTheDocument();
  });

  it("says when a large table was profiled only in part, and that it includes held-out rows", async () => {
    serve(undefined, () => HttpResponse.json({ ...profile, total_rows: 5_000_000, profiled_rows: 1_000_000, total_columns: 250 }));
    expect(await screen.findByText(/Profiled the first 1,000,000 of 5,000,000 rows\./)).toBeInTheDocument();
    expect(screen.getByText(/Showing the first 4 of 250 columns\./)).toBeInTheDocument();
    expect(screen.getByText(/including held-out test rows/)).toHaveTextContent("not to choose features, transforms or models");
  });

  it("shows another dataset when it is picked", async () => {
    const asked = serve();
    await userEvent.click(await screen.findByRole("button", { name: /^penguins\.csv/ }));
    await screen.findByRole("region", { name: "Read one column" });
    expect(asked).toContain(`/api/artifacts/${penguins.artifact.id}/profile`);
  });

  it("asks for one page of rows and the profile, nothing more (ADR-0038)", async () => {
    const asked = serve();
    await screen.findByRole("table", { name: "Rows of iris.csv" });
    await screen.findByRole("region", { name: "Read one column" });
    expect(asked.filter((p) => p.endsWith("/rows"))).toEqual([`/api/artifacts/${iris.artifact.id}/rows`]);
    expect(asked.every((p) => p === "/api/loaded_tables" || p.endsWith("/profile") || p.endsWith("/rows") || p === "/api/pipeline_versions")).toBe(true);
  });

  it("opens the step that loads it in the flow", async () => {
    serve();
    await userEvent.click(await screen.findByRole("button", { name: "Open in flow" }));
    expect(useSelection.getState()).toMatchObject({ nav: "Flow", pipelineVersionId: PV, runId: RUN, nodeId: "load" });
  });

  it("has Explore, Investigation and Lineage tabs; Lineage lists each step loading the table", async () => {
    serve();
    expect((await screen.findAllByRole("tab")).map((t) => t.textContent)).toEqual(["Explore", "Investigation", "Lineage"]);
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
    expect(await screen.findByRole("alert")).toHaveTextContent("profile_timeout");
  });

  it("says why the preview's rows could not be read", async () => {
    server.use(http.get("/api/artifacts/:id/rows", () => HttpResponse.json({ errors: [{ code: "not_found", message: "no such artifact" }] }, { status: 404 })));
    serve();
    expect(await screen.findByRole("alert")).toHaveTextContent("The rows could not be read: not_found");
  });
});
