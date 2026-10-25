import type { CodeSplitRequest, FlowDecision, NotebookSettingsRequest, PipelineVersion } from "@sprisk/contracts";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { delay, http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { stageNotebooks } from "../src/notebook/stageNotebooks.ts";
import { StageNotebook } from "../src/views/notebook/StageNotebook.tsx";
import { useSelection } from "../src/workbench/selection.ts";
import { notebookOperator, operators, pipeline, RUN } from "./fixtures.ts";
import { renderWithApi } from "./render.tsx";
import { server } from "./server.ts";

/** The fixture flow with a code step in Clean that reads the imputed train rows. */
const flow: PipelineVersion = {
  ...pipeline,
  nodes: [...pipeline.nodes.map((n) => (n.id === "impute" ? { ...n, methodology_decision_id: "mdc_01JABCDEFGHJKMNPQRSTVWXYZ0", stage: "clean" as const } : n)), { id: "rate", operator: notebookOperator.id, params: { source: "rate = impute_train.height", inputs: ["impute_train"], outputs: [] } }],
  edges: [...pipeline.edges, { from: "impute.train", to: "rate.impute_train" }],
};

/** The section named `name` of `flow`, as the Notebooks page passes it. */
function sectionOf(flow: PipelineVersion, name: string, decisions: FlowDecision[] = []) {
  const byRef = new Map([...operators, notebookOperator].map((o) => [o.id, o]));
  const found = stageNotebooks(flow, byRef, decisions).find((s) => s.name === name);
  if (!found) throw new Error(`no section ${name}`);
  return found;
}

function withApi() {
  const sent = { versions: [] as PipelineVersion[], runs: [] as unknown[], split: [] as CodeSplitRequest[], code: [] as string[] };
  // Impute writes itself as plain code; no other ready-made step here does.
  const writing = operators.map((o) => (o.id.startsWith("sprisk.clean.impute@") ? { ...o, notebook_code: "sprisk_clean.impute:as_code" } : o));
  server.use(
    http.get("/api/pipeline_versions", () => HttpResponse.json([flow])),
    http.get("/api/operators", () => HttpResponse.json([...writing, notebookOperator])),
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
      (sent.code.push(String(params.id)), String(params.id).startsWith("sprisk.clean.impute@"))
        ? HttpResponse.json({ code: "impute_train, impute_test = fill(split_train, split_test, method='median')\n" })
        : HttpResponse.json({ errors: [{ code: "no_plain_code", message: "none yet" }] }, { status: 404 }),
    ),
    // As Python reads an edited cell: the same call with another method is that setting.
    http.post("/api/operators/:id/notebook_settings", async ({ request }) => {
      const body = (await request.json()) as NotebookSettingsRequest;
      const method = /^impute_train, impute_test = fill\(split_train, split_test, method='(\w+)'\)\n?$/.exec(body.code)?.[1];
      return HttpResponse.json(method ? { reads_as: "settings", settings: { ...body.settings, method } } : { reads_as: "code" });
    }),
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

/** Selects cell `n` and deletes it from the toolbar, as a person does. */
async function deleteCell(n: number) {
  await userEvent.click(await screen.findByRole("group", { name: `Cell ${n}` }));
  await userEvent.click(screen.getByRole("button", { name: "Delete Cell" }));
}

describe("a stage in the notebook editor (ADR-0055)", () => {
  it("shows each step as plain Python: a ready-made step's code, a code step's own", async () => {
    withApi();
    renderWithApi(<StageNotebook pipeline={flow} section={sectionOf(flow, "Features")} />);
    expect(await screen.findByRole("textbox", { name: "Cell 1" })).toHaveValue("impute_train, impute_test = fill(split_train, split_test, method='median')\n");
    expect(screen.getByRole("textbox", { name: "Cell 2" })).toHaveValue("rate = impute_train.height");
  });

  it("shows a ready-made step with no plain code yet as one line saying so, never a form", async () => {
    withApi();
    renderWithApi(<StageNotebook pipeline={flow} section={sectionOf(flow, "Split")} />);
    expect(await screen.findByText("# sprisk.validation.random_split@1.0.0 has no plain code yet; its settings are in the flow's Parameters tab.")).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Cell 1" })).not.toBeInTheDocument();
  });

  it("asks for plain code only from steps that write it", async () => {
    const sent = withApi();
    renderWithApi(<StageNotebook pipeline={flow} section={sectionOf(flow, "Split")} />);
    await screen.findByText("# sprisk.validation.random_split@1.0.0 has no plain code yet; its settings are in the flow's Parameters tab.");
    renderWithApi(<StageNotebook pipeline={flow} section={sectionOf(flow, "Features")} />);
    await screen.findByRole("textbox", { name: "Cell 2" });
    expect(sent.code).toEqual(["sprisk.clean.impute@1.0.0"]);
  });

  it("a step whose code cannot be written says so in its own cell, and the others still show", async () => {
    withApi();
    server.use(http.post("/api/operators/:id/notebook_code", () => HttpResponse.json({ errors: [{ code: "code_failed", message: "the writer broke" }] }, { status: 500 })));
    renderWithApi(<StageNotebook pipeline={flow} section={sectionOf(flow, "Features")} />);
    expect(await screen.findByRole("textbox", { name: "Cell 2" })).toHaveValue("rate = impute_train.height");
    expect(await screen.findByText(/impute's code could not be written: .*the writer broke/)).toBeInTheDocument();
  });

  it("shows no made-up run number on a cell", async () => {
    withApi();
    renderWithApi(<StageNotebook pipeline={flow} section={sectionOf(flow, "Features")} />);
    // The step ran in the run on screen, but a flow run gives no kernel count to show.
    await screen.findByRole("textbox", { name: "Cell 1" });
    expect(screen.queryByText(/^\[\d+\]$/)).not.toBeInTheDocument();
  });

  it("editing a ready-made step's code makes it a code step running that code, and says its checks no longer cover it", async () => {
    const sent = withApi();
    renderWithApi(<StageNotebook pipeline={flow} section={sectionOf(flow, "Features")} />);
    const code = await screen.findByRole("textbox", { name: "Cell 1" });
    await userEvent.clear(code);
    await userEvent.type(code, "impute_train, impute_test = fill(split_train, split_test, 0)");
    await userEvent.click(screen.getByRole("button", { name: "Run cell 1" }));
    await waitFor(() => expect(sent.versions).toHaveLength(1));
    const impute = sent.versions[0]!.nodes.find((n) => n.id === "impute")!;
    expect(impute.operator).toBe(notebookOperator.id);
    expect(impute.params["source"]).toBe("impute_train, impute_test = fill(split_train, split_test, 0)");
    expect(await screen.findByText("impute is now your own Python code. The methodology checks for Imputation steps no longer cover it.")).toBeInTheDocument();
  });

  it("changing only a value in a ready-made step's code changes its setting and keeps the step", async () => {
    const sent = withApi();
    renderWithApi(<StageNotebook pipeline={flow} section={sectionOf(flow, "Features")} />);
    const code = await screen.findByRole("textbox", { name: "Cell 1" });
    await userEvent.clear(code);
    await userEvent.type(code, "impute_train, impute_test = fill(split_train, split_test, method='mean')");
    await userEvent.click(screen.getByRole("button", { name: "Run cell 1" }));
    await waitFor(() => expect(sent.versions).toHaveLength(1));
    const impute = sent.versions[0]!.nodes.find((n) => n.id === "impute")!;
    expect(impute).toEqual({ ...flow.nodes.find((n) => n.id === "impute"), params: { columns: ["x"], method: "mean" } });
  });

  it("running an edited code cell saves its step in a new flow version and runs it", async () => {
    const sent = withApi();
    renderWithApi(<StageNotebook pipeline={flow} section={sectionOf(flow, "Features")} />);
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

  it("a cell added to a stage with a decision is saved in that stage (ADR-0065)", async () => {
    const sent = withApi();
    const fair: FlowDecision = {
      decides: "split.method", method: "methodology.supervised.split_method@1.0.0", name: "Train/test split", activity: "Fair evaluation",
      question: "How are rows divided?", option: "item_groups", label: "Keep each item's rows on one side",
      reason: "Why.", assurance: "rule", steps: ["split"], promises: [],
    };
    renderWithApi(<StageNotebook pipeline={flow} section={sectionOf(flow, "Split", [fair])} />);
    await userEvent.click(await screen.findByRole("button", { name: "Code" }));
    const added = await screen.findByRole("textbox", { name: "Cell 2" });
    await userEvent.type(added, "n = 1");
    await userEvent.click(screen.getByRole("button", { name: "Run cell 2" }));
    await waitFor(() => expect(sent.versions).toHaveLength(1));
    const made = sent.versions[0]!.nodes.filter((n) => !flow.nodes.some((old) => old.id === n.id));
    expect(made).toHaveLength(1);
    expect(made[0]!.stage).toBe("split");
  });

  it("running an unchanged cell runs the flow again without a new version", async () => {
    const sent = withApi();
    renderWithApi(<StageNotebook pipeline={flow} section={sectionOf(flow, "Features")} />);
    await userEvent.click(await screen.findByRole("button", { name: "Run cell 1" }));
    await waitFor(() => expect(sent.runs).toEqual([{ pipeline_version_id: flow.id, reuse_run_id: RUN }]));
    expect(sent.versions).toEqual([]);
  });

  it("deleting a step nothing reads saves the flow without it", async () => {
    const sent = withApi();
    renderWithApi(<StageNotebook pipeline={flow} section={sectionOf(flow, "Features")} />);
    await deleteCell(2);
    await waitFor(() => expect(sent.versions).toHaveLength(1));
    expect(sent.versions[0]!.nodes.map((n) => n.id)).not.toContain("rate");
  });

  it("is busy while a deleted step's flow saves", async () => {
    withApi();
    server.use(http.post("/api/pipeline_versions", async () => {
      await delay("infinite");
      return HttpResponse.json({});
    }));
    renderWithApi(<StageNotebook pipeline={flow} section={sectionOf(flow, "Features")} />);
    await deleteCell(2);
    await waitFor(() => expect(screen.getByRole("button", { name: "Run all" })).toBeDisabled());
  });

  it("refuses to delete a step another step reads, naming it", async () => {
    const sent = withApi();
    renderWithApi(<StageNotebook pipeline={flow} section={sectionOf(flow, "Features")} />);
    await deleteCell(1);
    expect(await screen.findByRole("alert")).toHaveTextContent("Cannot delete impute: model, score, rate read its output.");
    expect(sent.versions).toEqual([]);
  });
});
