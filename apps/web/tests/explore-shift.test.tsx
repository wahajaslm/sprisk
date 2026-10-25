import type { AttemptOutput, DatasetProfile, LoadedTable, TableShift } from "@sprisk/contracts";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { DatasetsPage } from "../src/views/datasets/DatasetsPage.tsx";
import { attempts, loadOutputs, PV, RUN } from "./fixtures.ts";
import { renderWithApi } from "./render.tsx";
import { server } from "./server.ts";

const table: LoadedTable = {
  name: "iris.csv",
  operator: "sprisk.io.file_source@1.0.0",
  artifact: loadOutputs[0]!.artifact,
  total_rows: 120,
  total_columns: 1,
  used_by: [{ pipeline_version_id: PV, run_id: RUN, node_id: "load" }],
};
const profile: DatasetProfile = {
  total_rows: 120,
  total_columns: 1,
  profiled_rows: 120,
  band_rows: 3,
  columns: [{ name: "x", data_type: "Float64", role: "number", missing: 0, distinct: 80, missing_by_band: [0] }],
  correlation: { columns: [], pairs: [] },
};
const split = attempts.find((a) => a.node_id === "split" && a.state === "succeeded")!;
const output = (port: string, id: string): AttemptOutput => ({ port, artifact: { ...loadOutputs[0]!.artifact, id, producer_attempt_id: split.id } });
const TRAIN = "art_01JABCDEFGHJKMNPQRSTVWXY70";
const TEST = "art_01JABCDEFGHJKMNPQRSTVWXY71";
const shift: TableShift = {
  schema_version: "sprisk.table_shift/v1",
  rows: 90,
  other_rows: 30,
  columns: [
    { column: "instability", ks: 0.24, lower: 0, upper: 10, counts: [40, 50], other_counts: [5, 25] },
    { column: "mol_weight", ks: 0.1, lower: 200, upper: 2100, counts: [60, 30], other_counts: [20, 10] },
  ],
};

function serve() {
  const asked: string[] = [];
  server.events.on("request:start", ({ request }) => {
    const url = new URL(request.url);
    if (url.pathname.endsWith("/shift")) asked.push(`${url.pathname}${url.search}`);
  });
  server.use(
    http.get("/api/loaded_tables", () => HttpResponse.json([table])),
    http.get("/api/artifacts/:id/profile", () => HttpResponse.json(profile)),
    http.get(`/api/attempts/${split.id}/outputs`, () => HttpResponse.json([output("train", TRAIN), output("test", TEST)])),
    http.get("/api/artifacts/:id/shift", () => HttpResponse.json(shift)),
  );
  renderWithApi(<DatasetsPage />);
  return asked;
}

describe("the split on the Explore page (design: Check splits and groups)", () => {
  it("compares the flow split's train rows with its test rows, the shifted column red", async () => {
    const asked = serve();
    const section = await screen.findByRole("region", { name: "Check the split" }, { timeout: 5000 });
    await within(section).findByRole("list", { name: "Train vs test shift" });
    expect(asked).toContain(`/api/artifacts/${TRAIN}/shift?against=${TEST}`);
    expect(section).toHaveTextContent("Train vs test shift · KS statistic · 90 / 30 rows");
    const rows = within(within(section).getByRole("list", { name: "Train vs test shift" })).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("instability0.24");
    expect(rows[0]).toHaveClass("warn");
    expect(rows[1]).not.toHaveClass("warn");
    expect(section).toHaveTextContent("instability is shifted in the test rows (KS 0.24). Every other column stays under 0.2.");
  });

  it("overlays the train and test shares of the picked column", async () => {
    serve();
    const section = await screen.findByRole("region", { name: "Check the split" }, { timeout: 5000 });
    expect(await within(section).findByRole("img", { name: "instability · train vs test" })).toBeInTheDocument();
    await userEvent.click(within(section).getByRole("button", { name: /mol_weight/ }));
    expect(within(section).getByRole("img", { name: "mol_weight · train vs test" })).toBeInTheDocument();
  });
});
