import type { AttemptOutput, DatasetProfile } from "@sprisk/contracts";
import { screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { StepChange } from "../src/views/inspector/StepChange.tsx";
import { attempts, loadOutputs, pipeline } from "./fixtures.ts";
import { renderWithApi } from "./render.tsx";
import { server } from "./server.ts";

const splitAttempt = attempts.find((a) => a.node_id === "split" && a.state === "succeeded")!;
const table = (id: string, port: string): AttemptOutput => ({ port, artifact: { ...loadOutputs[0]!.artifact, id, producer_attempt_id: splitAttempt.id } });
const train = table("art_01JABCDEFGHJKMNPQRSTVWXY81", "train");
const test = table("art_01JABCDEFGHJKMNPQRSTVWXY82", "test");

const profile = (rows: number, columns: string[]): DatasetProfile => ({
  total_rows: rows,
  total_columns: columns.length,
  profiled_rows: rows,
  band_rows: 0,
  columns: columns.map((name) => ({ name, data_type: "Float64", missing: 0, distinct: 2, missing_by_band: [] })),
  correlation: { columns: [], pairs: [] },
});

function serve() {
  const rows: Record<string, DatasetProfile> = {
    [loadOutputs[0]!.artifact.id]: profile(120, ["x", "y", "row_id"]),
    [train.artifact.id]: profile(90, ["x", "y"]),
    [test.artifact.id]: profile(30, ["x", "y"]),
  };
  server.use(
    http.get(`/api/attempts/${splitAttempt.id}/outputs`, () => HttpResponse.json([train, test])),
    http.get("/api/artifacts/:id/profile", ({ params }) => HttpResponse.json(rows[String(params.id)])),
  );
  renderWithApi(<StepChange pipeline={pipeline} nodeId="split" attempts={attempts} />);
}

describe("what a step did to its tables (ADR-0065)", () => {
  it("draws the rows a split read and the rows on each side", async () => {
    serve();
    const section = await screen.findByRole("region", { name: "What this step did" });
    expect(await within(section).findByRole("img", { name: "Rows in and out" })).toBeInTheDocument();
  });

  it("names the columns the step dropped", async () => {
    serve();
    const section = await screen.findByRole("region", { name: "What this step did" });
    expect(await within(section).findByText("row_id")).toBeInTheDocument();
    expect(within(section).getByText("Columns removed")).toBeInTheDocument();
  });

  it("shows nothing for a step that reads no table", () => {
    renderWithApi(<StepChange pipeline={pipeline} nodeId="load" attempts={attempts} />);
    expect(screen.queryByRole("region", { name: "What this step did" })).toBeNull();
  });
});
