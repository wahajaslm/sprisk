import type { CodeSplitRequest, PipelineVersion } from "@sprisk/contracts";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { StageNotebook } from "../src/views/notebook/StageNotebook.tsx";
import { useSelection } from "../src/workbench/selection.ts";
import { notebookOperator, operators, pipeline, RUN } from "./fixtures.ts";
import { renderWithApi } from "./render.tsx";
import { server } from "./server.ts";

/** The fixture flow with a code step in Clean that reads the imputed train rows. */
const flow: PipelineVersion = {
  ...pipeline,
  nodes: [...pipeline.nodes, { id: "rate", operator: notebookOperator.id, params: { source: "rate = impute_train.height", inputs: ["impute_train"], outputs: [] } }],
  edges: [...pipeline.edges, { from: "impute.train", to: "rate.impute_train" }],
};

function withApi() {
  const sent = { versions: [] as PipelineVersion[], runs: [] as unknown[], split: [] as CodeSplitRequest[] };
  server.use(
    http.get("/api/pipeline_versions", () => HttpResponse.json([flow])),
    http.get("/api/operators", () => HttpResponse.json([...operators, notebookOperator])),
    http.post("/api/code/split", async ({ request }) => {
      const body = (await request.json()) as CodeSplitRequest;
      sent.split.push(body);
      // As Python reads them, for one-line cells: the left of ` = ` sets names, and a name on
      // the right that an earlier cell set is read. Each name links to its latest setter.
      const sets = (cell: string) => (cell.includes(" = ") ? cell.split(" = ").slice(0, -1).flatMap((side) => side.split(", ")) : []);
      const steps = body.cells.map((source, i) => {
        const right = source.split(" = ").at(-1) ?? "";
        const earlier = new Set(body.cells.slice(0, i).flatMap(sets));
        const inputs = [...new Set(right.match(/[a-z_]+/g) ?? [])].filter((n) => earlier.has(n));
        return { source, cells: [i], parameters: [], inputs, outputs: sets(source) };
      });
      const links = steps.flatMap((step, to) =>
        step.inputs.map((name) => ({ from_step: steps.findLastIndex((s, i) => i < to && s.outputs.includes(name)), to_step: to, name })),
      );
      return HttpResponse.json({ steps, links, notes: [] });
    }),
    // Impute has plain code; other steps have none yet.
    http.post("/api/operators/:id/notebook_code", ({ params }) =>
      String(params.id).startsWith("sprisk.clean.impute@")
        ? HttpResponse.json({ code: "impute_train, impute_test = fill(split_train, split_test)\n" })
        : HttpResponse.json({ errors: [{ code: "no_plain_code", message: "none yet" }] }, { status: 404 }),
    ),
    http.post("/api/pipeline_versions", async ({ request }) => {
      const body = (await request.json()) as PipelineVersion;
      sent.versions.push(body);
      return HttpResponse.json(body, { status: 201 });
    }),
    http.post("/api/runs", async ({ request }) => {
      const body = (await request.json()) as { pipeline_version_id: string };
      sent.runs.push(body);
      return HttpResponse.json({ schema_version: "sprisk.run/v1", id: "run_01JABCDEFGHJKMNPQRSTVWXYZ9", project_id: flow.project_id, pipeline_version_id: body.pipeline_version_id, status: "queued", created_at: "2026-10-21T10:00:00Z" }, { status: 201 });
    }),
  );
  useSelection.setState({ pipelineVersionId: flow.id, runId: RUN });
  return sent;
}

describe("a stage in the notebook editor (ADR-0055)", () => {
  it("shows each step as plain Python: a ready-made step's code, a code step's own", async () => {
    withApi();
    renderWithApi(<StageNotebook pipeline={flow} stage="Clean" />);
    expect(await screen.findByRole("textbox", { name: "Cell 1" })).toHaveValue("impute_train, impute_test = fill(split_train, split_test)\n");
    expect(screen.getByRole("textbox", { name: "Cell 2" })).toHaveValue("rate = impute_train.height");
  });

  it("shows a ready-made step with no plain code yet as its settings form", async () => {
    withApi();
    renderWithApi(<StageNotebook pipeline={flow} stage="Split" />);
    expect(await screen.findByText("reads load_data → gives split_train, split_test")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Cell 1" })).not.toBeInTheDocument();
  });

  it("editing a ready-made step's code makes it a code step running that code", async () => {
    const sent = withApi();
    renderWithApi(<StageNotebook pipeline={flow} stage="Clean" />);
    const code = await screen.findByRole("textbox", { name: "Cell 1" });
    await userEvent.clear(code);
    await userEvent.type(code, "impute_train, impute_test = fill(split_train, split_test, 0)");
    await userEvent.click(screen.getByRole("button", { name: "Run cell 1" }));
    await waitFor(() => expect(sent.versions).toHaveLength(1));
    const impute = sent.versions[0]!.nodes.find((n) => n.id === "impute")!;
    expect(impute.operator).toBe(notebookOperator.id);
    expect(impute.params["source"]).toBe("impute_train, impute_test = fill(split_train, split_test, 0)");
  });

  it("running an edited code cell saves its step in a new flow version and runs it", async () => {
    const sent = withApi();
    renderWithApi(<StageNotebook pipeline={flow} stage="Clean" />);
    const code = await screen.findByRole("textbox", { name: "Cell 2" });
    await userEvent.clear(code);
    await userEvent.type(code, "rate = impute_train.height * 2");
    await userEvent.click(screen.getByRole("button", { name: "Run cell 2" }));
    await waitFor(() => expect(sent.runs).toHaveLength(1));
    expect(sent.versions).toHaveLength(1);
    expect(sent.versions[0]!.parent_id).toBe(flow.id);
    expect(sent.versions[0]!.nodes.find((n) => n.id === "rate")?.params["source"]).toBe("rate = impute_train.height * 2");
    expect(sent.runs[0]).toEqual({ pipeline_version_id: sent.versions[0]!.id, reuse_run_id: RUN });
  });

  it("running an unchanged cell runs the flow again without a new version", async () => {
    const sent = withApi();
    renderWithApi(<StageNotebook pipeline={flow} stage="Clean" />);
    await userEvent.click(await screen.findByRole("button", { name: "Run cell 1" }));
    await waitFor(() => expect(sent.runs).toEqual([{ pipeline_version_id: flow.id, reuse_run_id: RUN }]));
    expect(sent.versions).toEqual([]);
  });

  it("deleting a step nothing reads saves the flow without it", async () => {
    const sent = withApi();
    renderWithApi(<StageNotebook pipeline={flow} stage="Clean" />);
    await userEvent.click(await screen.findByRole("button", { name: "Delete cell 2" }));
    await waitFor(() => expect(sent.versions).toHaveLength(1));
    expect(sent.versions[0]!.nodes.map((n) => n.id)).not.toContain("rate");
  });

  it("refuses to delete a step another step reads, naming it", async () => {
    const sent = withApi();
    renderWithApi(<StageNotebook pipeline={flow} stage="Clean" />);
    await userEvent.click(await screen.findByRole("button", { name: "Delete cell 1" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Cannot delete impute: model, score, rate read its output.");
    expect(sent.versions).toEqual([]);
  });
});
