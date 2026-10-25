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
    { name: "sepal_length", data_type: "Float64", role: "number", missing: 6, distinct: 35, missing_by_band: [0, 0.5], quartiles: { min: 4.3, q1: 5.1, median: 5.8, q3: 6.4, max: 7.9 }, histogram: { kind: "bins", bars: [{ label: "4.3–5", count: 50 }, { label: "5–7.9", count: 64 }] } },
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

  it("draws the missing share per column and lists each column with a gap, red from the threshold", async () => {
    const gappy = { ...profile, columns: profile.columns.map((c) => (c.name === "sepal_length" ? { ...c, missing: 30 } : c)) };
    serve(undefined, () => HttpResponse.json(gappy));
    await openProfile();
    const section = await screen.findByRole("region", { name: "Missing values" });
    expect(within(section).getByRole("img", { name: "Missing share per column" })).toBeInTheDocument();
    expect(section).toHaveTextContent("1 column at or above 20% empty");
    const rows = within(within(section).getByRole("list", { name: "Missing per column" })).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("sepal_length25.0%");
    expect(rows[0]).toHaveClass("warn");
  });

  it("lists every column in one profile table: role, type, missing share, unique, median", async () => {
    serve();
    await openProfile();
    const table = await screen.findByRole("table", { name: "Column profile" });
    const sepal = within(table).getByRole("row", { name: /sepal_length/ });
    expect(sepal).toHaveTextContent("number");
    expect(sepal).toHaveTextContent("Float64");
    expect(sepal).toHaveTextContent("5%");
    expect(sepal).toHaveTextContent("35");
    expect(sepal).toHaveTextContent("5.8");
    expect(within(table).getByRole("img", { name: "Distribution of sepal_length" })).toBeInTheDocument();
    expect(screen.getByText("1 free text · 1 category · 2 numbers")).toBeInTheDocument();
  });

  it("lists what stands out, warnings first, with an example from the data", async () => {
    serve();
    await openProfile();
    const findings = within(await screen.findByRole("region", { name: "Findings" })).getAllByRole("listitem");
    expect(findings[0]).toHaveClass("warn");
    expect(findings[0]).toHaveTextContent("Warningnote holds blank text in 12 of 120 rows");
    expect(findings[1]).toHaveTextContent("Example: same note");
  });

  it("shows warnings and a few notes first, and every finding on request", async () => {
    const many = { ...profile, findings: Array.from({ length: 9 }, (_, i) => ({ level: "note" as const, topic: "spelling" as const, column: `c${i}`, text: `note ${i}` })) };
    serve(undefined, () => HttpResponse.json(many));
    await openProfile();
    const findings = await screen.findByRole("region", { name: "Findings" });
    expect(within(findings).getAllByRole("listitem")).toHaveLength(6);
    await userEvent.click(within(findings).getByRole("button", { name: "Show all 9 findings" }));
    expect(within(findings).getAllByRole("listitem")).toHaveLength(9);
  });

  it("draws each column's values by its role: a category's common values, a text's words and repeats, a number's spread", async () => {
    serve();
    await openProfile();
    const species = await screen.findByRole("article", { name: "species" });
    expect(within(species).getByRole("list", { name: "Most common values of species" })).toHaveTextContent("setosa40 · 33.3%");
    const note = screen.getByRole("article", { name: "note" });
    expect(within(note).getByRole("img", { name: "Words per value in note" })).toBeInTheDocument();
    expect(within(note).getByRole("list", { name: "Most repeated values of note" })).toBeInTheDocument();
    const sepal = screen.getByRole("article", { name: "sepal_length" });
    expect(within(sepal).getByRole("img", { name: "Distribution of sepal_length" })).toBeInTheDocument();
    expect(sepal).toHaveTextContent("median5.8");
  });

  it("draws where values are missing along the rows", async () => {
    serve();
    await openProfile();
    expect(await screen.findByRole("img", { name: "Where sepal_length is missing" })).toBeInTheDocument();
  });

  it("draws a correlation matrix only for three or more measured numbers", async () => {
    serve();
    await openProfile();
    await screen.findByRole("table", { name: "Column profile" });
    expect(screen.queryByRole("img", { name: "Correlation matrix" })).toBeNull();
  });

  it("draws the correlation matrix for three measured numbers", async () => {
    serve(undefined, () => HttpResponse.json({ ...profile, correlation: { ...profile.correlation, columns: ["sepal_length", "petal_width", "petal_length"] } }));
    await openProfile();
    expect(await screen.findByRole("img", { name: "Correlation matrix" })).toBeInTheDocument();
  });

  it("puts the table's numbers in the Info dock, not in a row under the header", async () => {
    serve(undefined, () => HttpResponse.json({ ...profile, duplicate_rows: 3 }));
    expect(await screen.findByText("Duplicate rows")).toBeInTheDocument();
    expect(screen.getByText("Empty cells")).toBeInTheDocument();
  });

  it("says when a large table was profiled only in part", async () => {
    serve(undefined, () => HttpResponse.json({ ...profile, total_rows: 5_000_000, profiled_rows: 1_000_000, total_columns: 250 }));
    await openProfile();
    expect(await screen.findByText(/Profiled the first 1,000,000 of 5,000,000 rows\./)).toBeInTheDocument();
    expect(screen.getByText(/Showing the first 4 of 250 columns\./)).toBeInTheDocument();
  });

  it("says the profile includes held-out rows and is for looking, not for choosing", async () => {
    serve();
    await openProfile();
    expect(await screen.findByText(/including held-out test rows/)).toHaveTextContent("not to choose features, transforms or models");
  });


  it("shows another dataset's profile when it is picked", async () => {
    const asked = serve();
    await userEvent.click(await screen.findByRole("button", { name: /^penguins\.csv/ }));
    await openProfile();
    await screen.findByRole("article", { name: "sepal_length" });
    expect(asked).toContain(`/api/artifacts/${penguins.artifact.id}/profile`);
  });

  it("asks for one page of rows for the preview, and no rows for the profile (ADR-0038)", async () => {
    const asked = serve();
    await screen.findByRole("table", { name: "Rows of iris.csv" });
    await openProfile();
    await screen.findByRole("table", { name: "Column profile" });
    const rows = asked.filter((p) => p.endsWith("/rows"));
    expect(rows).toEqual([`/api/artifacts/${iris.artifact.id}/rows`]);
    expect(asked.every((p) => p === "/api/loaded_tables" || p.endsWith("/profile") || p.endsWith("/rows") || p === "/api/pipeline_versions")).toBe(true);
  });

  it("pages through the rows: next shows the following 50, and says which rows are shown", async () => {
    serve();
    const preview = await screen.findByRole("region", { name: "Preview" });
    expect(await within(preview).findByText("Rows 1–50 of 120")).toBeInTheDocument();
    await userEvent.click(within(preview).getByRole("button", { name: "Next rows" }));
    expect(await within(preview).findByText("Rows 51–100 of 120")).toBeInTheDocument();
    expect(within(preview).getByRole("cell", { name: "51" })).toBeInTheDocument();
    expect(within(preview).getByRole("button", { name: "Previous rows" })).toBeEnabled();
  });

  it("jumps to the row a person types", async () => {
    serve();
    const preview = await screen.findByRole("region", { name: "Preview" });
    await userEvent.type(await within(preview).findByRole("spinbutton", { name: "Go to row" }), "101{Enter}");
    expect(await within(preview).findByText("Rows 101–120 of 120")).toBeInTheDocument();
    expect(within(preview).getByRole("button", { name: "Next rows" })).toBeDisabled();
  });

  it("hides and shows a column", async () => {
    serve();
    const preview = await screen.findByRole("region", { name: "Preview" });
    const table = await within(preview).findByRole("table", { name: "Rows of iris.csv" });
    expect(within(table).getByRole("columnheader", { name: /species/ })).toBeInTheDocument();
    await userEvent.click(within(preview).getByRole("checkbox", { name: "species" }));
    expect(within(table).queryByRole("columnheader", { name: /species/ })).toBeNull();
    await userEvent.click(within(preview).getByRole("checkbox", { name: "species" }));
    expect(within(table).getByRole("columnheader", { name: /species/ })).toBeInTheDocument();
  });

  it("heads each column with its type and its distribution, as the design's data preview does", async () => {
    serve();
    const table = await screen.findByRole("table", { name: "Rows of iris.csv" });
    const header = within(table).getByRole("columnheader", { name: /sepal_length/ });
    expect(header).toHaveTextContent("Float64");
    expect(await within(header).findByRole("img", { name: "Distribution of sepal_length" })).toBeInTheDocument();
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
    const preview = await screen.findByRole("table", { name: "Rows of iris.csv" });
    expect(screen.getByRole("tab", { name: "Preview" })).toHaveAttribute("aria-selected", "true");
    expect(limit).toBe("50");
    expect(within(preview).getByRole("cell", { name: "0.2" })).toHaveClass("num");
    expect(within(preview).getByRole("cell", { name: "—" })).toBeInTheDocument();
    expect(screen.getByText("Rows 1–2 of 120")).toBeInTheDocument();
  });

  it("opens the step that loads it in the flow", async () => {
    serve();
    await userEvent.click(await screen.findByRole("button", { name: "Open in flow" }));
    expect(useSelection.getState()).toMatchObject({ nav: "Flow", pipelineVersionId: PV, runId: RUN, nodeId: "load" });
  });

  it("has Preview, Profile, Investigation and Lineage tabs; Lineage lists each step loading the table", async () => {
    serve();
    expect((await screen.findAllByRole("tab")).map((t) => t.textContent)).toEqual(["Preview", "Profile", "Investigation", "Lineage"]);
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
    await openProfile();
    expect(await screen.findByRole("alert")).toHaveTextContent("profile_timeout");
  });

  it("says why the preview's rows could not be read", async () => {
    server.use(http.get("/api/artifacts/:id/rows", () => HttpResponse.json({ errors: [{ code: "not_found", message: "no such artifact" }] }, { status: 404 })));
    serve();
    expect(await screen.findByRole("alert")).toHaveTextContent("The rows could not be read: not_found");
  });
});
