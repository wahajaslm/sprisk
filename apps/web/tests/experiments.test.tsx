import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { Experiments } from "../src/views/Experiments.tsx";
import { useSelection } from "../src/workbench/selection.ts";
import { PV, RUN, attempts, pipeline, run, scoreAttempt, scoreOutputs } from "./fixtures.ts";
import { renderWithApi } from "./render.tsx";
import { server } from "./server.ts";

const PV2 = "plv_01JABCDEFGHJKMNPQRSTVWXYZ2";
const RUN2 = "run_01JABCDEFGHJKMNPQRSTVWXYZ2";
const edited = {
  ...pipeline,
  id: PV2,
  parent_id: PV,
  nodes: pipeline.nodes.map((n) => (n.id === "split" ? { ...n, params: { test_fraction: 0.25, seed: 7 } } : n)),
};
const run2 = { ...run, id: RUN2, pipeline_version_id: PV2, created_at: "2026-10-16T11:00:00Z" };
const score2 = { ...scoreAttempt, id: "att_01JABCDEFGHJKMNPQRSTVWXY60", run_id: RUN2 };
const metrics2 = { ...scoreOutputs[0]!, artifact: { ...scoreOutputs[0]!.artifact, id: "art_01JABCDEFGHJKMNPQRSTVWXY60" } };

function twoVersions() {
  server.use(
    http.get("/api/pipeline_versions", () => HttpResponse.json([edited, pipeline])),
    http.get("/api/runs", ({ request }) => {
      const pv = new URL(request.url).searchParams.get("pipeline_version_id");
      return HttpResponse.json(pv === PV2 ? [run2] : [run]);
    }),
    http.get(`/api/runs/${RUN2}/attempts`, () => HttpResponse.json([...attempts.filter((a) => a.node_id !== "score"), score2])),
    http.get(`/api/attempts/${score2.id}/outputs`, () => HttpResponse.json([metrics2])),
    http.get(`/api/artifacts/${metrics2.artifact.id}/content`, () => HttpResponse.text('{"accuracy": 0.9}')),
  );
  useSelection.setState({ pipelineVersionId: PV2, runId: RUN2 });
}

describe("experiments", () => {
  it("lists every run of the flow across its versions, with what changed and its metric", async () => {
    twoVersions();
    renderWithApi(<Experiments />);
    const table = await screen.findByRole("table", { name: "Runs" });
    expect(await screen.findByText("2 runs")).toBeInTheDocument();
    const rows = within(table).getAllByRole("row").slice(1);
    await waitFor(() => expect(rows[0]).toHaveTextContent("0.9"));
    expect(rows[0]).toHaveTextContent("split seed 42 → 7");
    expect(rows[1]).toHaveTextContent("0.947");
  });

  it("compares the two chosen runs: settings that differ and metrics side by side", async () => {
    twoVersions();
    renderWithApi(<Experiments />);
    const diff = await screen.findByRole("region", { name: "Settings that differ" });
    await waitFor(() => expect(diff).toHaveTextContent("split · seed"));
    expect(diff).toHaveTextContent("42");
    expect(diff).toHaveTextContent("7");
    const metrics = screen.getByRole("region", { name: "Metrics" });
    await waitFor(() => expect(metrics).toHaveTextContent("0.947"));
    expect(metrics).toHaveTextContent("0.9");
    expect(metrics).toHaveTextContent("▼ 0.047");
  });

  it("opens a run in the Flow view", async () => {
    twoVersions();
    renderWithApi(<Experiments />);
    const table = await screen.findByRole("table", { name: "Runs" });
    await userEvent.click(within(table).getAllByRole("button", { name: "Open in Flow" })[1]!);
    expect(useSelection.getState()).toMatchObject({ nav: "Flow", pipelineVersionId: PV, runId: RUN });
  });

  it("says so when the flow has fewer than two runs to compare", async () => {
    useSelection.setState({ pipelineVersionId: PV, runId: RUN });
    renderWithApi(<Experiments />);
    expect(await screen.findByText(/Run the flow again/)).toBeInTheDocument();
  });
});

describe("comparison cautions", () => {
  it("warns that a changed split means different test rows, and how much one row moves a metric", async () => {
    twoVersions();
    renderWithApi(<Experiments />);
    const metrics = await screen.findByRole("region", { name: "Metrics" });
    expect(await within(metrics).findByText(/split changed, so the two runs were scored on different test rows/)).toBeInTheDocument();
    await waitFor(() => expect(metrics).toHaveTextContent("One test row moves accuracy by about 0.026"));
  });
});
