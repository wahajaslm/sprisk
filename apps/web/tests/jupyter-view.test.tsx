import type { CodeSplit, PipelineVersion } from "@sprisk/contracts";
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";

import { cellsFromFile, NOTEBOOK_OPERATOR } from "../src/flow/notebook.ts";
import { FlowPanel } from "../src/views/FlowPanel.tsx";
import JupyterNotebookView from "../src/views/jupyter/JupyterNotebook.tsx";
import { useSelection } from "../src/workbench/selection.ts";
import { useWorkbench } from "../src/workbench/workbench.ts";
import { attempts, codeAttempt, codeDisplayJson, codeOutputs, fakeDock, notebookOperator, operators, pipeline, PV, RUN, run } from "./fixtures.ts";
import { renderWithApi } from "./render.tsx";

// Charts need a real browser; the notebook's chart renderers call these.
vi.mock("../src/views/drawPlotly.ts", () => ({ drawPlotly: vi.fn(() => () => undefined) }));
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
const LOAD_SOURCE = "def f(path, format):\n    ...";
const STAND_IN = "load_data = df = object()";

function withApi(split: (cells: string[]) => CodeSplit | Response) {
  const sent: { cells: string[][]; versions: PipelineVersion[]; runs: unknown[] } = { cells: [], versions: [], runs: [] };
  server.use(
    http.get("/api/pipeline_versions", () => HttpResponse.json([flow])),
    http.get("/api/operators", () => HttpResponse.json([...operators, notebookOperator])),
    http.get("/api/operators/:id/source", ({ params }) =>
      HttpResponse.json({ operator: params.id, path: "sprisk_io/file_source.py", language: "python", text: LOAD_SOURCE, digest: `sha256:${"a".repeat(64)}` }),
    ),
    http.post("/api/code/split", async ({ request }) => {
      const { cells } = (await request.json()) as { cells: string[] };
      sent.cells.push(cells);
      const found = split(cells);
      return found instanceof Response ? found : HttpResponse.json(found);
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
    http.get("/api/runs/run_01JABCDEFGHJKMNPQRSTVWXYZ9/attempts", () => HttpResponse.json([])),
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

/** A key as a browser sends it, to the focused element. Lumino reads keyCode, which
 * user-event leaves out. */
function press(key: string, keyCode: number, shiftKey = false) {
  act(() => {
    document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key, keyCode, shiftKey, bubbles: true, cancelable: true }));
  });
}

/** JupyterLab's cells as shown: prompt and source text. */
async function shownCells(container: HTMLElement) {
  await waitFor(() => expect(container.querySelectorAll(".jp-Cell").length).toBeGreaterThan(0));
  return [...container.querySelectorAll<HTMLElement>(".jp-Cell")];
}

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(URL, "createObjectURL");
  Reflect.deleteProperty(URL, "revokeObjectURL");
});

describe("the flow in JupyterLab's notebook (ADR-0034)", () => {
  it("shows a built-in step as its collapsed code and read-only call, and a code step as its cell", async () => {
    withApi(linear);
    const { container } = renderWithApi(<JupyterNotebookView />);
    const [code, call, cell] = await shownCells(container);
    expect(code?.querySelector(".jp-InputPlaceholder")).toBeInTheDocument();
    expect(call?.textContent).toContain('load_data = df = f(path=Path("/d/iris.csv"), format="csv")');
    expect(call?.querySelector(".cm-content")).toHaveAttribute("aria-readonly", "true");
    expect(cell?.textContent).toContain("n = df.height");
    expect(screen.getByRole("toolbar", { name: "Notebook" })).toHaveTextContent("Python · runs in sprisk");
  });

  it("fills in each step's run as a kernel would: [n] and its outputs under its cell", async () => {
    withApi(linear);
    const cellAttempt = { ...codeAttempt, node_id: "cell_1" };
    server.use(
      http.get(`/api/runs/${RUN}/attempts`, () => HttpResponse.json([...attempts, cellAttempt])),
      http.get(`/api/attempts/${cellAttempt.id}/outputs`, () => HttpResponse.json(codeOutputs)),
      http.get(`/api/artifacts/${codeOutputs[0]!.artifact.id}/content`, () => HttpResponse.text(codeDisplayJson)),
    );
    const { container } = renderWithApi(<JupyterNotebookView />);
    const [, call, cell] = await shownCells(container);
    await waitFor(() => expect(call?.querySelector(".jp-OutputArea")).toHaveTextContent("load_data: 120 rows × 2 columns"));
    expect(call?.querySelector(".jp-InputPrompt")).toHaveTextContent("[1]:");
    await waitFor(() => expect(cell?.querySelector(".jp-OutputArea")).toHaveTextContent("150"));
    expect(cell?.querySelector(".jp-InputPrompt")).toHaveTextContent("[2]:");
  });

  it("shows a code step's figure as a picture, and printed links as plain text (rule 7)", async () => {
    withApi(linear);
    const cellAttempt = { ...codeAttempt, node_id: "cell_1" };
    const shown = JSON.stringify({
      items: [
        { kind: "text", text: "see javascript://%0aalert(document.domain)// or https://example.com\n" },
        { kind: "figure", figure: { library: "matplotlib", format: "svg", content: "<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>" } },
        { kind: "figure", figure: { library: "plotly", format: "plotly_json", content: '{"data":[]}' } },
      ],
    });
    server.use(
      http.get(`/api/runs/${RUN}/attempts`, () => HttpResponse.json([...attempts, cellAttempt])),
      http.get(`/api/attempts/${cellAttempt.id}/outputs`, () => HttpResponse.json(codeOutputs)),
      http.get(`/api/artifacts/${codeOutputs[0]!.artifact.id}/content`, () => HttpResponse.text(shown)),
    );
    const { container } = renderWithApi(<JupyterNotebookView />);
    const [, , cell] = await shownCells(container);
    await waitFor(() => expect(cell?.querySelector(".jp-OutputArea img")).toBeInTheDocument());
    const img = cell!.querySelector<HTMLImageElement>(".jp-OutputArea img")!;
    expect(img.src.startsWith("data:image/svg+xml")).toBe(true);
    expect(cell!.querySelector(".jp-OutputArea script")).toBeNull();
    expect(cell!.querySelector(".jp-OutputArea a")).toBeNull();
    expect(cell!.querySelector(".jp-OutputArea")).toHaveTextContent("javascript://%0aalert(document.domain)//");
    await waitFor(() => expect(cell!.querySelector(".jp-RenderedFigure")).toBeInTheDocument());
  });

  it("marks a step that is running with [*]", async () => {
    withApi(linear);
    const running = { ...codeAttempt, node_id: "cell_1", state: "running" as const };
    server.use(http.get(`/api/runs/${RUN}/attempts`, () => HttpResponse.json([...attempts, running])));
    const { container } = renderWithApi(<JupyterNotebookView />);
    const [, , cell] = await shownCells(container);
    await waitFor(() => expect(cell?.querySelector(".jp-InputPrompt")).toHaveTextContent("[*]:"));
  });

  it("shows a failed step as a Jupyter error under its cell", async () => {
    withApi(linear);
    const failed = { ...codeAttempt, node_id: "cell_1", state: "failed" as const, error: { code: "code_error", message: "NameError: name 'df' is not defined" } };
    server.use(http.get(`/api/runs/${RUN}/attempts`, () => HttpResponse.json([...attempts, failed])));
    const { container } = renderWithApi(<JupyterNotebookView />);
    const [, , cell] = await shownCells(container);
    await waitFor(() => expect(cell?.querySelector(".jp-OutputArea")).toHaveTextContent("NameError: name 'df' is not defined"));
  });

  it("runs the active cell through sprisk: Python reads the links, the next version is saved and run", async () => {
    const sent = withApi(linear);
    const { container } = renderWithApi(<JupyterNotebookView />);
    const [, , cell] = await shownCells(container);
    await userEvent.click(cell!.querySelector(".jp-InputPrompt")!);
    await userEvent.click(screen.getByRole("button", { name: "Run this cell (Shift+Enter)" }));

    await waitFor(() => expect(sent.runs).toHaveLength(1));
    expect(sent.cells).toEqual([[STAND_IN, "n = df.height"]]);
    const [saved] = sent.versions;
    expect(saved?.parent_id).toBe(PV);
    expect(saved?.nodes).toEqual(flow.nodes);
    expect(sent.runs[0]).toEqual({ pipeline_version_id: saved?.id, reuse_run_id: RUN });
    expect(useSelection.getState()).toMatchObject({ pipelineVersionId: saved?.id, nodeId: "cell_1" });
  });

  it("runs with Shift+Enter, adds a cell with B and deletes it with D D, as in JupyterLab", async () => {
    const sent = withApi(linear);
    const { container } = renderWithApi(<JupyterNotebookView />);
    const [, , cell] = await shownCells(container);
    await userEvent.click(cell!.querySelector(".jp-InputPrompt")!);
    press("b", 66);
    expect(await shownCells(container)).toHaveLength(4);
    press("d", 68);
    press("d", 68);
    await waitFor(() => expect(container.querySelectorAll(".jp-Cell")).toHaveLength(3));
    // JupyterLab gives focus back on the next frame, which jsdom does not draw.
    await userEvent.click(container.querySelectorAll(".jp-Cell .jp-InputPrompt")[2]!);
    press("Enter", 13, true);
    await waitFor(() => expect(sent.runs).toHaveLength(1));
    expect(sent.cells).toEqual([[STAND_IN, "n = df.height"]]);
  });

  it("makes a cell added with + a new step", async () => {
    const sent = withApi(linear);
    const { container } = renderWithApi(<JupyterNotebookView />);
    const [, , cell] = await shownCells(container);
    await userEvent.click(cell!.querySelector(".jp-InputPrompt")!);
    await userEvent.click(screen.getByRole("button", { name: "Insert a cell below (B)" }));
    expect(await shownCells(container)).toHaveLength(4);
    await userEvent.click(screen.getByRole("button", { name: "Run this cell (Shift+Enter)" }));

    await waitFor(() => expect(sent.versions).toHaveLength(1));
    expect(sent.cells).toEqual([[STAND_IN, "n = df.height", ""]]);
  });

  it("says why the cells cannot be saved, and saves nothing", async () => {
    const sent = withApi(() => HttpResponse.json({ errors: [{ code: "split_failed", message: "the analyzer timed out" }] }, { status: 500 }));
    const { container } = renderWithApi(<JupyterNotebookView />);
    await shownCells(container);
    await userEvent.click(screen.getByRole("button", { name: "Run this cell (Shift+Enter)" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("the analyzer timed out");
    expect(sent.versions).toEqual([]);
  });

  it("downloads the flow as a .ipynb", async () => {
    withApi(linear);
    const createObjectURL = vi.fn((_blob: Blob) => "blob:notebook");
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const { container } = renderWithApi(<JupyterNotebookView />);
    await shownCells(container);
    await userEvent.click(screen.getByRole("button", { name: "Download as .ipynb" }));
    expect(click).toHaveBeenCalled();
    const text = (await createObjectURL.mock.calls[0]?.[0]?.text()) ?? "";
    expect(cellsFromFile("flow.ipynb", text)).toEqual([`${LOAD_SOURCE}\n\nfrom pathlib import Path\n\nload_data = df = f(path=Path("/d/iris.csv"), format="csv")`, "n = df.height"]);
  });

  it("makes the step picked on the canvas the active cell, and the active cell's step the selection", async () => {
    withApi(linear);
    const { container } = renderWithApi(<JupyterNotebookView />);
    const [, call, cell] = await shownCells(container);
    act(() => useSelection.setState({ nodeId: "cell_1" }));
    await waitFor(() => expect(cell).toHaveClass("jp-mod-active"));
    await userEvent.click(call!.querySelector(".jp-InputPrompt")!);
    expect(useSelection.getState().nodeId).toBe("load");
  });
});

describe("the Flow panel's Notebook view", () => {
  it("hides the Inspector tabs while the notebook shows, and brings them back for the canvas", async () => {
    withApi(linear);
    const dock = fakeDock();
    useWorkbench.setState({ dock });
    renderWithApi(<FlowPanel />);
    await userEvent.click(screen.getByRole("radio", { name: "Notebook" }));
    expect(dock.setInspectorVisible).toHaveBeenLastCalledWith(false);
    expect(await screen.findByRole("toolbar", { name: "Notebook" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: "Flow" }));
    expect(dock.setInspectorVisible).toHaveBeenLastCalledWith(true);
    expect(await screen.findByLabelText("Flow canvas")).toBeInTheDocument();
  });
});
