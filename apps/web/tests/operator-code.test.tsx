import type { CodeSplitRequest, PipelineVersion } from "@sprisk/contracts";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { OperatorCode } from "../src/views/inspector/OperatorCode.tsx";
import { useSelection } from "../src/workbench/selection.ts";
import { notebookOperator, operators, pipeline, RUN } from "./fixtures.ts";
import { renderWithApi } from "./render.tsx";
import { server } from "./server.ts";

const PLAIN = "impute_train, impute_test = fill(split_train, split_test)\n";
const impute = operators.find((o) => o.id === "sprisk.clean.impute@1.0.0")!;

function withApi(plain: boolean) {
  const versions: PipelineVersion[] = [];
  server.use(
    http.get("/api/operators", () => HttpResponse.json([...operators, notebookOperator])),
    http.post("/api/operators/:id/notebook_code", () =>
      plain ? HttpResponse.json({ code: PLAIN }) : HttpResponse.json({ errors: [{ code: "no_plain_code", message: "none yet" }] }, { status: 404 }),
    ),
    // This edit is more than values, so it reads as code.
    http.post("/api/operators/:id/notebook_settings", () => HttpResponse.json({ reads_as: "code" })),
    http.get("/api/operators/:id/source", ({ params }) =>
      HttpResponse.json({ operator: params.id, path: "sprisk_clean/impute.py", language: "python", text: "def impute(train, test):\n    ...\n", digest: `sha256:${"0".repeat(64)}` }),
    ),
    http.post("/api/code/split", async ({ request }) => {
      const body = (await request.json()) as CodeSplitRequest;
      const sets = (cell: string) => (cell.includes(" = ") ? cell.split(" = ").slice(0, -1).flatMap((side) => side.split(", ")) : []);
      const steps = body.cells.map((source, i) => {
        const earlier = new Set(body.cells.slice(0, i).flatMap(sets));
        const inputs = [...new Set((source.split(" = ").at(-1) ?? "").match(/[a-z_]+/g) ?? [])].filter((n) => earlier.has(n));
        return { source, cells: [i], parameters: [], inputs, outputs: sets(source) };
      });
      const links = steps.flatMap((step, to) => step.inputs.map((name) => ({ from_step: steps.findLastIndex((s, i) => i < to && s.outputs.includes(name)), to_step: to, name })));
      return HttpResponse.json({ steps, links, notes: [] });
    }),
    http.post("/api/pipeline_versions", async ({ request }) => {
      const body = (await request.json()) as PipelineVersion;
      versions.push(body);
      return HttpResponse.json(body, { status: 201 });
    }),
    http.post("/api/runs", async ({ request }) => {
      const body = (await request.json()) as { pipeline_version_id: string };
      return HttpResponse.json({ schema_version: "sprisk.run/v1", id: "run_01JABCDEFGHJKMNPQRSTVWXYZ9", project_id: pipeline.project_id, pipeline_version_id: body.pipeline_version_id, status: "queued", created_at: "2026-10-21T10:00:00Z" }, { status: 201 });
    }),
  );
  useSelection.setState({ pipelineVersionId: pipeline.id, runId: RUN });
  return versions;
}

describe("a ready-made step's Code tab (ADR-0055)", () => {
  it("shows the same plain Python as the step's notebook cell", async () => {
    withApi(true);
    renderWithApi(<OperatorCode pipeline={pipeline} nodeId="impute" operator={impute} />);
    expect(await screen.findByRole("textbox", { name: "Code of impute" })).toHaveValue(PLAIN);
  });

  it("editing it makes the step that code, as editing the notebook cell does", async () => {
    const versions = withApi(true);
    renderWithApi(<OperatorCode pipeline={pipeline} nodeId="impute" operator={impute} />);
    await userEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const code = screen.getByRole("textbox", { name: "Code of impute" });
    await userEvent.clear(code);
    await userEvent.type(code, "impute_train, impute_test = fill(split_train, split_test, 0)");
    await userEvent.click(screen.getByRole("button", { name: "Run code" }));
    await waitFor(() => expect(versions).toHaveLength(1));
    const step = versions[0]!.nodes.find((n) => n.id === "impute")!;
    expect(step.operator).toBe(notebookOperator.id);
    expect(step.params["source"]).toBe("impute_train, impute_test = fill(split_train, split_test, 0)");
  });

  it("shows the step's module while it has no plain code yet", async () => {
    withApi(false);
    renderWithApi(<OperatorCode pipeline={pipeline} nodeId="impute" operator={impute} />);
    expect(await screen.findByRole("textbox", { name: "Code of sprisk_clean/impute.py" })).toHaveValue("def impute(train, test):\n    ...\n");
  });
});
