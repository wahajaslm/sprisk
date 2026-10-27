import type { DatasetProfile, DatasetVersion } from "@sprisk/contracts";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it } from "vitest";

import { DatasetsPage } from "../src/views/datasets/DatasetsPage.tsx";
import { renderWithApi } from "./render.tsx";
import { server } from "./server.ts";

const events: DatasetVersion = {
  schema_version: "sprisk.dataset_version/v1",
  id: "dsv_01JABCDEFGHJKMNPQRSTVWXYZ0",
  name: "events",
  location: "file:///data/events/",
  format: "csv",
  file_count: 3,
  size_bytes: 2_500_000_000,
  fingerprint: "sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
  created_at: "2026-10-27T10:00:00Z",
};

const sample: DatasetProfile = {
  total_columns: 1,
  profiled_rows: 1_000_000,
  band_rows: 25_000,
  columns: [{ name: "x", data_type: "Int64", role: "number", missing: 0, distinct: 10, missing_by_band: [0], histogram: { kind: "bins", bars: [{ label: "0–9", count: 1_000_000 }] } }],
  correlation: { columns: [], pairs: [] },
};

function serve(added: () => Response = () => HttpResponse.json(events, { status: 201 })) {
  const sources: DatasetVersion[] = [];
  const sent: unknown[] = [];
  const asked: string[] = [];
  server.events.on("request:start", ({ request }) => {
    asked.push(new URL(request.url).pathname);
  });
  server.use(
    http.get("/api/loaded_tables", () => HttpResponse.json([])),
    http.get("/api/dataset_versions", () => HttpResponse.json(sources)),
    http.post("/api/dataset_versions", async ({ request }) => {
      sent.push(await request.json());
      const answer = added();
      if (answer.ok) sources.push(events);
      return answer;
    }),
    http.get(`/api/dataset_versions/${events.id}/profile`, () => HttpResponse.json(sample)),
  );
  renderWithApi(<DatasetsPage />);
  return { sent, asked };
}

const add = async (location: string) => {
  await userEvent.type(await screen.findByRole("textbox", { name: "Data source path or URI" }), location);
  await userEvent.click(screen.getByRole("button", { name: "Add" }));
};

afterEach(() => server.events.removeAllListeners());

describe("data sources (ADR-0067)", () => {
  it("adds a source by its path, lists it and opens it on Explore with its sample note", async () => {
    const { sent, asked } = serve();
    await add("/data/events/");

    expect(sent).toEqual([{ location: "/data/events/" }]);
    expect(await screen.findByRole("heading", { name: "events" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^events/ })).toBeInTheDocument();
    expect(await screen.findByText(/Profiled the first 1,000,000 rows\. The total was not counted/)).toBeInTheDocument();
    expect(screen.getByText(/Read in place/)).toBeInTheDocument();
    // A source is profiled where it lives; the page never asks for its rows.
    expect(asked.some((p) => p.includes("/rows") || p.includes("/content"))).toBe(false);
  });

  it.each([
    ["path_outside_data_roots", "/etc/passwd is outside the data roots"],
    ["path_not_found", "/data/none.csv: No such file or directory"],
    ["unsupported_scheme", "https:// locations are not supported: use a local path, file://, s3://, gs:// or az://"],
  ])("shows why a source was refused: %s", async (code, message) => {
    serve(() => HttpResponse.json({ errors: [{ code, message }] }, { status: 422 }));
    await add("/somewhere");

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.queryByRole("button", { name: /^events/ })).not.toBeInTheDocument();
  });

  it("does not send an empty location", async () => {
    const { sent } = serve();
    await screen.findByRole("textbox", { name: "Data source path or URI" });
    expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();
    await waitFor(() => expect(sent).toEqual([]));
  });
});
