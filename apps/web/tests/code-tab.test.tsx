import type { CodeSplit, PipelineVersion } from "@sprisk/contracts";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { NOTEBOOK_OPERATOR } from "../src/flow/notebook.ts";
import { CodeEditor } from "../src/views/CodeEditor.tsx";
import { useSelection } from "../src/workbench/selection.ts";
import { notebookOperator, operators, pipeline, PV, RUN, run } from "./fixtures.ts";
import { renderWithApi } from "./render.tsx";
import { server } from "./server.ts";

/** load (built-in) → one notebook cell reading its table as df. */
const flow: PipelineVersion = {
  ...pipeline,
  nodes: [
    { id: "load", operator: "sprisk.io.file_source@1.0.0", params: { path: "/d/iris.csv", format: "csv" } },
    { id: "cell_1", operator: NOTEBOOK_OPERATOR, params: { source: "n = df.height", inputs: ["df"] } },
  ],
  edges: [{ from: "load.data", to: "cell_1.df" }],
};
const STAND_IN = "load_data = df = object()";

function withApi(split: (cells: string[]) => CodeSplit) {
  const sent: { cells: string[][]; versions: PipelineVersion[]; runs: unknown[] } = { cells: [], versions: [], runs: [] };
  server.use(
    http.get("/api/pipeline_versions", () => HttpResponse.json([flow])),
    http.get("/api/operators", () => HttpResponse.json([...operators, notebookOperator])),
    http.get("/api/operators/:id/source", ({ params }) =>
      HttpResponse.json({ operator: params.id, path: "sprisk_io/file_source.py", language: "python", text: "def f(path, format):\n    ...", digest: `sha256:${"a".repeat(64)}` }),
    ),
    http.post("/api/code/split", async ({ request }) => {
      const { cells } = (await request.json()) as { cells: string[] };
      sent.cells.push(cells);
      return HttpResponse.json(split(cells));
    }),
    http.post("/api/pipeline_versions", async ({ request }) => {
      const body = (await request.json()) as PipelineVersion;
      sent.versions.push(body);
      return HttpResponse.json(body, { status: 201 });
    }),
    http.post("/api/runs", async ({ request }) => {
      sent.runs.push(await request.json());
      return HttpResponse.json({ ...run, id: "run_01JABCDEFGHJKMNPQRSTVWXYZ9" }, { status: 202 });
    }),
  );
  useSelection.setState({ pipelineVersionId: PV, runId: RUN });
  return sent;
}

/** What Python reads in the cells: the stand-in sets df, every later cell reads it. */
const linear = (cells: string[]): CodeSplit => ({
  steps: cells.map((source, i) => ({ cells: [i], source, inputs: i === 0 ? [] : ["df"], outputs: i === 0 ? ["df"] : [] })),
  links: cells.slice(1).map((_, i) => ({ from_step: 0, to_step: i + 1, name: "df" })),
  notes: [],
});

describe("a code step's Code tab", () => {
  it("re-reads the links when its code changes, as the notebook does", async () => {
    const sent = withApi(linear);
    renderWithApi(<CodeEditor pipeline={flow} nodeId="cell_1" source="n = df.height" />);
    const code = await screen.findByRole("textbox", { name: "Code for cell_1" });
    await userEvent.clear(code);
    await userEvent.type(code, "n = df.width{Shift>}{Enter}{/Shift}");

    await waitFor(() => expect(sent.runs).toHaveLength(1));
    expect(sent.cells).toEqual([[STAND_IN, "n = df.width"]]);
    expect(sent.versions[0]?.nodes[1]?.params).toEqual({ source: "n = df.width", inputs: ["df"] });
  });
});
