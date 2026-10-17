import type { CodeSplit, PipelineVersion } from "@sprisk/contracts";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { cellsFromFile, NOTEBOOK_OPERATOR } from "../src/flow/notebook.ts";
import { CodeEditor } from "../src/views/CodeEditor.tsx";
import { FlowPanel } from "../src/views/FlowPanel.tsx";
import { NotebookView } from "../src/views/NotebookView.tsx";
import { useSelection } from "../src/workbench/selection.ts";
import { useWorkbench } from "../src/workbench/workbench.ts";
import { attempts, codeAttempt, codeDisplayJson, codeOutputs, codePipeline, fakeDock, notebookOperator, operators, pipeline, PV, RUN, run } from "./fixtures.ts";
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
const LOAD_CALL = 'load_data = df = f(path=Path("/d/iris.csv"), format="csv")';
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
  steps: cells.map((source, i) => ({ cells: [i], source, parameters: [], inputs: i === 0 ? [] : ["df"], outputs: i === 0 ? ["df"] : [] })),
  links: cells.slice(1).map((_, i) => ({ from_step: 0, to_step: i + 1, name: "df" })),
  notes: [],
});

afterEach(() => {
  vi.restoreAllMocks();
  // jsdom has no object URLs; the download test adds them.
  Reflect.deleteProperty(URL, "createObjectURL");
  Reflect.deleteProperty(URL, "revokeObjectURL");
});

// The editor and the canvas load lazily; load them once here so no test waits on an import.
beforeAll(async () => {
  await import("../src/views/MonacoCode.tsx");
  await import("../src/views/FlowCanvas.tsx");
});

describe("the notebook view of a flow (ADR-0035)", () => {
  it("shows each step as a cell in flow order: a built-in step as its call, a code step as its code", async () => {
    withApi(linear);
    renderWithApi(<NotebookView />);
    const call = await screen.findByRole("textbox", { name: "Cell 1" });
    expect(call).toHaveValue(LOAD_CALL);
    expect(call).toHaveAttribute("readonly");
    expect(await screen.findByRole("textbox", { name: "Cell 2" })).toHaveValue("n = df.height");
    expect(screen.queryByRole("button", { name: "Run cell 1" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run cell 2" })).toBeInTheDocument();
  });

  it("shows each step's output under its cells: a table's first rows, and what the code printed and showed", async () => {
    withApi(linear);
    const cellAttempt = { ...codeAttempt, node_id: "cell_1" };
    server.use(
      http.get(`/api/runs/${RUN}/attempts`, () => HttpResponse.json([...attempts, cellAttempt])),
      http.get(`/api/attempts/${cellAttempt.id}/outputs`, () => HttpResponse.json(codeOutputs)),
      http.get(`/api/artifacts/${codeOutputs[0]!.artifact.id}/content`, () => HttpResponse.text(codeDisplayJson)),
    );
    renderWithApi(<NotebookView />);
    const load = await screen.findByRole("group", { name: "load" });
    expect(await within(load).findByText((_, el) => el?.tagName === "FIGCAPTION" && el.textContent === "load_data · 120 rows × 2 columns")).toBeInTheDocument();
    expect(within(load).getByRole("table", { name: "load_data" })).toBeInTheDocument();
    expect(within(load).getByText("succeeded")).toBeInTheDocument();
    const cell = screen.getByRole("group", { name: "cell_1" });
    expect(await within(cell).findByText("150")).toBeInTheDocument();
    expect(within(cell).getByText("1 of 150 rows")).toBeInTheDocument();
    expect(within(cell).getByRole("img", { name: "Figure 1" })).toBeInTheDocument();
    expect(within(cell).getByText("[2]")).toBeInTheDocument();
  });

  it("marks a failed step as failed and shows its error under the cell", async () => {
    withApi(linear);
    const failed = { ...codeAttempt, node_id: "cell_1", state: "failed" as const, error: { code: "code_error", message: "NameError: name 'df' is not defined" } };
    server.use(http.get(`/api/runs/${RUN}/attempts`, () => HttpResponse.json([...attempts, failed])));
    renderWithApi(<NotebookView />);
    const cell = await screen.findByRole("group", { name: "cell_1" });
    expect(await within(cell).findByText("code_error: NameError: name 'df' is not defined")).toBeInTheDocument();
    expect(within(cell).getByText("failed")).toBeInTheDocument();
  });

  it("moves to the next cell after Shift+Enter, and stays after Ctrl+Enter, as in VS Code", async () => {
    const three: PipelineVersion = {
      ...flow,
      nodes: [...flow.nodes, { id: "cell_2", operator: NOTEBOOK_OPERATOR, params: { source: "m = df.width", inputs: ["df"] } }],
      edges: [...flow.edges, { from: "load.data", to: "cell_2.df" }],
    };
    const sent = withApi(linear);
    server.use(http.get("/api/pipeline_versions", () => HttpResponse.json([three, ...sent.versions])));
    const { container } = renderWithApi(<NotebookView />);
    const cellOf = (n: number) => container.querySelector<HTMLElement>(`[data-cell="${n}"]`);
    await userEvent.type(await screen.findByRole("textbox", { name: "Cell 2" }), "{Shift>}{Enter}{/Shift}");
    await waitFor(() => expect(sent.runs).toHaveLength(1));
    await waitFor(() => expect(cellOf(3)).toHaveFocus());
    expect(cellOf(3)).toHaveClass("active");

    await userEvent.type(await screen.findByRole("textbox", { name: "Cell 3" }), "{Control>}{Enter}{/Control}");
    await waitFor(() => expect(sent.runs).toHaveLength(2));
    await waitFor(() => expect(cellOf(3)).toHaveFocus());
  });

  it("selects the cell of a step picked on the canvas", async () => {
    withApi(linear);
    const { container } = renderWithApi(<NotebookView />);
    await screen.findByRole("textbox", { name: "Cell 2" });
    act(() => useSelection.setState({ nodeId: "cell_1" }));
    await waitFor(() => expect(container.querySelector('[data-cell="2"]')).toHaveClass("active"));
    act(() => useSelection.setState({ nodeId: "load" }));
    await waitFor(() => expect(container.querySelector('[data-cell="1"]')).toHaveClass("active"));
  });

  it("shows a built-in step's code from its cell toolbar", async () => {
    withApi(linear);
    renderWithApi(<NotebookView />);
    await userEvent.click(await screen.findByRole("button", { name: "Code of load" }));
    expect(await screen.findByRole("textbox", { name: "Code of sprisk_io/file_source.py" })).toHaveValue("def f(path, format):\n    ...");
  });

  it("runs the whole flow from Run All when nothing was edited", async () => {
    const sent = withApi(linear);
    renderWithApi(<NotebookView />);
    await userEvent.click(await screen.findByRole("button", { name: "Run All" }));
    await waitFor(() => expect(sent.runs).toEqual([{ pipeline_version_id: PV }]));
    expect(sent.versions).toEqual([]);
  });

  it("uses VS Code's keys on a selected cell: B adds below, D D deletes, arrows move, Enter edits", async () => {
    const sent = withApi(linear);
    const { container } = renderWithApi(<NotebookView />);
    const editor = await screen.findByRole("textbox", { name: "Cell 2" });
    const cellOf = (n: number) => container.querySelector<HTMLElement>(`[data-cell="${n}"]`)!;
    await userEvent.click(editor);
    await userEvent.keyboard("{Escape}");
    expect(cellOf(2)).toHaveFocus();
    await userEvent.keyboard("b");
    expect(await screen.findByRole("textbox", { name: "Cell 3" })).toBeInTheDocument();
    expect(cellOf(3)).toHaveClass("active");
    expect(cellOf(3)).toHaveFocus();
    await userEvent.keyboard("dd");
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "Cell 3" })).not.toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Discard edits" })).not.toBeInTheDocument();
    expect(cellOf(2)).toHaveFocus();
    await userEvent.keyboard("a");
    expect(await screen.findByRole("textbox", { name: "Cell 2" })).toHaveValue("");
    expect(cellOf(2)).toHaveFocus();
    await userEvent.keyboard("dd");
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Cell 2" })).toHaveValue("n = df.height"));
    act(() => cellOf(2).focus());
    await userEvent.keyboard("{ArrowUp}");
    expect(cellOf(1)).toHaveFocus();
    expect(useSelection.getState().nodeId).toBe("load");
    await userEvent.keyboard("{ArrowDown}{Enter}");
    expect(screen.getByRole("textbox", { name: "Cell 2" })).toHaveFocus();
    expect(sent.versions).toEqual([]);
  });

  it("runs a v1 code step's edited code as the next version", async () => {
    const sent = withApi(linear);
    server.use(http.get("/api/pipeline_versions", () => HttpResponse.json([codePipeline])));
    renderWithApi(<NotebookView />);
    const n = codePipeline.nodes.length;
    const cell = await screen.findByRole("textbox", { name: `Cell ${n}` });
    await userEvent.clear(cell);
    await userEvent.type(cell, "data.head(2){Shift>}{Enter}{/Shift}");

    await waitFor(() => expect(sent.runs).toHaveLength(1));
    expect(sent.cells).toEqual([]);
    expect(sent.versions[0]?.nodes.at(-1)?.params).toEqual({ source: "data.head(2)" });
    expect(useSelection.getState().nodeId).toBe("code_1");
  });

  it("runs an edited cell: Python reads its links, then the next version is saved and run from there", async () => {
    const sent = withApi(linear);
    renderWithApi(<NotebookView />);
    const cell = await screen.findByRole("textbox", { name: "Cell 2" });
    await userEvent.clear(cell);
    await userEvent.type(cell, "n = df.width{Shift>}{Enter}{/Shift}");

    await waitFor(() => expect(sent.runs).toHaveLength(1));
    expect(sent.cells).toEqual([[STAND_IN, "n = df.width"]]);
    const [saved] = sent.versions;
    expect(saved?.parent_id).toBe(PV);
    expect(saved?.nodes[1]).toEqual({ id: "cell_1", operator: NOTEBOOK_OPERATOR, params: { source: "n = df.width", inputs: ["df"] } });
    expect(saved?.edges).toEqual([{ from: "load.data", to: "cell_1.df" }]);
    expect(sent.runs[0]).toEqual({ pipeline_version_id: saved?.id, reuse_run_id: RUN });
    expect(useSelection.getState()).toMatchObject({ pipelineVersionId: saved?.id, nodeId: "cell_1" });
  });

  it("adds a cell as a new step, linked by the names it reads", async () => {
    const sent = withApi(linear);
    renderWithApi(<NotebookView />);
    await userEvent.click(await screen.findByRole("button", { name: "Add a cell after cell_1" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Cell 3" }), "m = df.width{Shift>}{Enter}{/Shift}");

    await waitFor(() => expect(sent.versions).toHaveLength(1));
    expect(sent.cells).toEqual([[STAND_IN, "n = df.height", "m = df.width"]]);
    expect(sent.versions[0]?.nodes.map((n) => n.id)).toEqual(["load", "cell_1", "cell_2"]);
    expect(sent.versions[0]?.edges).toContainEqual({ from: "load.data", to: "cell_2.df" });
    expect(useSelection.getState().nodeId).toBe("cell_2");
  });

  it("says why cells cannot be saved, and saves nothing", async () => {
    const sent = withApi(() => ({
      steps: [{ cells: [0, 1], source: "…", parameters: [], inputs: [], outputs: [] }],
      links: [],
      notes: [{ cell: 1, message: "f is a function or class from cell 1; cells 1–2 stay in one step" }],
    }));
    renderWithApi(<NotebookView />);
    await userEvent.type(await screen.findByRole("textbox", { name: "Cell 2" }), "{Shift>}{Enter}{/Shift}");
    expect(await screen.findByRole("alert")).toHaveTextContent("built-in step load sits between them");
    expect(sent.versions).toEqual([]);
  });

  it("shows Python's error when the cells cannot be read, and saves nothing", async () => {
    const sent = withApi(linear);
    server.use(http.post("/api/code/split", () => HttpResponse.json({ errors: [{ code: "split_failed", message: "the analyzer timed out" }] }, { status: 500 })));
    renderWithApi(<NotebookView />);
    await userEvent.type(await screen.findByRole("textbox", { name: "Cell 2" }), "{Shift>}{Enter}{/Shift}");
    expect(await screen.findByRole("alert")).toHaveTextContent("the analyzer timed out");
    expect(sent.versions).toEqual([]);
  });

  it("deletes a cell, then saves without it on Run All", async () => {
    const sent = withApi(linear);
    renderWithApi(<NotebookView />);
    await userEvent.click(await screen.findByRole("button", { name: "Delete cell 2" }));
    expect(screen.queryByRole("textbox", { name: "Cell 2" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Run All" }));

    await waitFor(() => expect(sent.versions).toHaveLength(1));
    expect(sent.cells).toEqual([[STAND_IN]]);
    expect(sent.versions[0]?.nodes.map((n) => n.id)).toEqual(["load"]);
  });

  it("discards edits not yet run", async () => {
    withApi(linear);
    renderWithApi(<NotebookView />);
    await userEvent.type(await screen.findByRole("textbox", { name: "Cell 2" }), " + 1");
    await userEvent.click(screen.getByRole("button", { name: "Discard edits" }));
    expect(screen.getByRole("textbox", { name: "Cell 2" })).toHaveValue("n = df.height");
    expect(screen.queryByRole("button", { name: "Discard edits" })).not.toBeInTheDocument();
  });

  it("downloads the flow as a .ipynb", async () => {
    withApi(linear);
    const createObjectURL = vi.fn((_blob: Blob) => "blob:notebook");
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    renderWithApi(<NotebookView />);
    const button = await screen.findByRole("button", { name: "Export" });
    await waitFor(() => expect(button).toBeEnabled());
    await userEvent.click(button);

    expect(click).toHaveBeenCalled();
    const blob = createObjectURL.mock.calls[0]?.[0];
    expect(cellsFromFile("flow.ipynb", (await blob?.text()) ?? "")).toEqual([
      `def f(path, format):\n    ...\n\nfrom pathlib import Path\n\n${LOAD_CALL}`,
      "n = df.height",
    ]);
  });

  it("switches the Flow panel between the canvas and the notebook", async () => {
    withApi(linear);
    renderWithApi(<FlowPanel />);
    expect(await screen.findByLabelText("Flow canvas")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: "Notebook" }));
    expect(await screen.findByLabelText("Notebook")).toBeInTheDocument();
    expect(screen.queryByLabelText("Flow canvas")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: "Flow" }));
    expect(await screen.findByLabelText("Flow canvas")).toBeInTheDocument();
  });
});

describe("a code step's Code tab", () => {
  it("re-reads the links when its code changes, as the notebook does", async () => {
    const sent = withApi(linear);
    renderWithApi(<CodeEditor pipeline={flow} nodeId="cell_1" source="n = df.height" />);
    const code = screen.getByRole("textbox", { name: "Code for cell_1" });
    await userEvent.clear(code);
    await userEvent.type(code, "n = df.width{Shift>}{Enter}{/Shift}");

    await waitFor(() => expect(sent.runs).toHaveLength(1));
    expect(sent.cells).toEqual([[STAND_IN, "n = df.width"]]);
    expect(sent.versions[0]?.nodes[1]?.params).toEqual({ source: "n = df.width", inputs: ["df"] });
  });
});
