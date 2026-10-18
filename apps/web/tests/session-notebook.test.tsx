import type { NotebookExecution, NotebookVersion, PipelineVersion } from "@sprisk/contracts";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { NotebooksPage } from "../src/views/notebook/NotebooksPage.tsx";
import { useSelection } from "../src/workbench/selection.ts";
import { notebookOperator, operators, pipeline } from "./fixtures.ts";
import { renderWithApi } from "./render.tsx";
import { server } from "./server.ts";

const NB = "nb_01JAAAAAAAAAAAAAAAAAAAAAAA";

const sales: NotebookVersion = {
  schema_version: "sprisk.notebook_version/v1",
  id: "nbv_01JAAAAAAAAAAAAAAAAAAAAAAB",
  notebook_id: NB,
  project_id: "prj_00000000000000000000000000",
  title: "Sales analysis",
  cells: [
    { id: "intro", kind: "markdown", source: "# Sales Analysis Notebook\n\nMonthly sales. <script>alert(1)</script> ![beacon](https://tracker.example/b.png) ![chart](data:image/png;base64,iVBOR)" },
    { id: "params", kind: "code", source: "MIN = 10" },
    { id: "load", kind: "code", source: "customers = load()" },
    { id: "filter", kind: "code", source: "eligible = customers[customers.n >= MIN]" },
    { id: "show", kind: "code", source: "eligible.describe()" },
  ],
  pipeline_version_id: pipeline.id,
  created_at: "2026-10-18T12:00:00Z",
};

type Sent = { executed: { cell_id: string; code: string }[]; saved: NotebookVersion[]; versions: PipelineVersion[]; split: unknown[]; posts: string[] };

function withApi(answer: (code: string, n: number) => NotebookExecution = (_, n) => ({ status: "ok", execution_count: n, outputs: [{ kind: "text", text: `out ${n}` }] })) {
  const sent: Sent = { executed: [], saved: [], versions: [], split: [], posts: [] };
  server.use(
    http.get("/api/notebooks", () => HttpResponse.json([sales])),
    http.get("/api/operators", () => HttpResponse.json([...operators, notebookOperator])),
    http.post(`/api/notebooks/${NB}/execute`, async ({ request }) => {
      const body = (await request.json()) as Sent["executed"][number];
      sent.executed.push(body);
      return HttpResponse.json(answer(body.code, sent.executed.length));
    }),
    http.post(`/api/notebooks/${NB}/interrupt`, () => {
      sent.posts.push("interrupt");
      return new HttpResponse(null, { status: 204 });
    }),
    http.post(`/api/notebooks/${NB}/restart`, () => {
      sent.posts.push("restart");
      return new HttpResponse(null, { status: 204 });
    }),
    http.post("/api/notebook_versions", async ({ request }) => {
      const body = (await request.json()) as NotebookVersion;
      sent.saved.push(body);
      return HttpResponse.json(body, { status: 201 });
    }),
    http.post("/api/pipeline_versions", async ({ request }) => {
      const body = (await request.json()) as PipelineVersion;
      sent.versions.push(body);
      return HttpResponse.json(body, { status: 201 });
    }),
    http.post("/api/code/split", async ({ request }) => {
      sent.split.push(await request.json());
      return HttpResponse.json({
        steps: [
          { source: "MIN = 10", cells: [0], parameters: [{ name: "MIN", value: 10 }], inputs: [], outputs: [] },
          { source: "customers = load()", cells: [1], parameters: [], inputs: [], outputs: ["customers"] },
          { source: "MIN = 10\neligible = customers[customers.n >= MIN]", cells: [2], parameters: [{ name: "MIN", value: 10 }], inputs: ["customers"], outputs: ["eligible", "model"] },
          { source: "eligible.describe()", cells: [3], parameters: [], inputs: ["eligible"], outputs: [] },
        ],
        links: [
          { from_step: 1, to_step: 2, name: "customers" },
          { from_step: 2, to_step: 3, name: "eligible" },
        ],
        notes: [],
      });
    }),
    http.get(`/api/notebooks/${NB}/variables`, () =>
      HttpResponse.json({
        variables: [
          { name: "eligible", defined: true, type: "pandas.DataFrame", table: true },
          { name: "model", defined: true, type: "sklearn.LogisticRegression", table: false },
        ],
      }),
    ),
  );
  return sent;
}

const cell = (n: number) => screen.getByRole("textbox", { name: `Cell ${n}` });

describe("the session notebook (ADR-0036)", () => {
  it("opens the latest notebook with its Markdown rendered and its code cells editable", async () => {
    withApi();
    renderWithApi(<NotebooksPage />);
    expect(await screen.findByRole("heading", { name: "Sales Analysis Notebook" })).toBeInTheDocument();
    expect(await screen.findByRole("textbox", { name: "Cell 2" })).toHaveValue("MIN = 10");
    expect(screen.getByRole("button", { name: "Sales analysis" })).toHaveAttribute("aria-current", "true");
  });

  it("never turns HTML in Markdown into elements", async () => {
    withApi();
    const { container } = renderWithApi(<NotebooksPage />);
    await screen.findByRole("heading", { name: "Sales Analysis Notebook" });
    expect(container.querySelector("script")).toBeNull();
  });

  it("never loads an image from the network for a Markdown cell", async () => {
    withApi();
    renderWithApi(<NotebooksPage />);
    await screen.findByRole("heading", { name: "Sales Analysis Notebook" });
    expect(screen.queryByRole("img", { name: "beacon" })?.getAttribute("src") ?? "").not.toContain("tracker.example");
    expect(screen.getByRole("img", { name: "chart" })).toHaveAttribute("src", "data:image/png;base64,iVBOR");
  });

  it("marks a cell edited since it ran, and a kernel restart clears every other result", async () => {
    withApi((code, n) =>
      code === "boom"
        ? { status: "error", execution_count: n, outputs: [], error: { name: "MemoryLimit", message: "restarted", traceback: [] }, kernel_restarted: true }
        : { status: "ok", execution_count: n, outputs: [{ kind: "text", text: `out ${n}` }] },
    );
    renderWithApi(<NotebooksPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Run cell 2" }));
    await screen.findByText("out 1");
    await userEvent.type(cell(2), "0");
    expect(screen.getByText("Changed since it ran")).toBeInTheDocument();
    await userEvent.clear(cell(3));
    await userEvent.type(cell(3), "boom");
    await userEvent.click(screen.getByRole("button", { name: "Run cell 3" }));
    await screen.findByText("MemoryLimit: restarted");
    expect(screen.queryByText("out 1")).not.toBeInTheDocument();
  });

  it("Shift+Enter runs the cell in the kernel, shows its output and count, and moves on", async () => {
    const sent = withApi();
    renderWithApi(<NotebooksPage />);
    await userEvent.type(await screen.findByRole("textbox", { name: "Cell 2" }), "{Shift>}{Enter}{/Shift}");
    expect(await screen.findByText("out 1")).toBeInTheDocument();
    expect(sent.executed).toEqual([{ cell_id: "params", code: "MIN = 10" }]);
    expect(within(screen.getByRole("group", { name: "Cell 2" })).getByText("[1]")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("group", { name: "Cell 3" })).toHaveClass("active"));
  });

  it("shows a cell's error with its name, message and traceback", async () => {
    withApi(() => ({ status: "error", execution_count: 1, outputs: [], error: { name: "NameError", message: "name 'load' is not defined", traceback: ["Cell In[1], line 1"] } }));
    renderWithApi(<NotebooksPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Run cell 3" }));
    expect(await screen.findByText("NameError: name 'load' is not defined")).toBeInTheDocument();
    expect(screen.getByText("Cell In[1], line 1")).toBeInTheDocument();
  });

  it("Run All runs every code cell in order, one at a time", async () => {
    const sent = withApi();
    renderWithApi(<NotebooksPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Run All" }));
    await waitFor(() => expect(sent.executed.map((e) => e.cell_id)).toEqual(["params", "load", "filter", "show"]));
    expect(await screen.findByText("out 4")).toBeInTheDocument();
  });

  it("Interrupt and Restart reach the kernel; a restart clears every output", async () => {
    const sent = withApi();
    renderWithApi(<NotebooksPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Run cell 2" }));
    await screen.findByText("out 1");
    await userEvent.click(screen.getByRole("button", { name: "Interrupt" }));
    await userEvent.click(screen.getByRole("button", { name: "Restart" }));
    await waitFor(() => expect(sent.posts).toEqual(["interrupt", "restart"]));
    await waitFor(() => expect(screen.queryByText("out 1")).not.toBeInTheDocument());
  });

  it("Save writes the edited cells as a new version over the last one; running does not save", async () => {
    const sent = withApi();
    useSelection.setState({ pipelineVersionId: pipeline.id });
    renderWithApi(<NotebooksPage />);
    await userEvent.type(await screen.findByRole("textbox", { name: "Cell 2" }), "0");
    await userEvent.click(screen.getByRole("button", { name: "Run cell 2" }));
    await screen.findByText("out 1");
    expect(sent.saved).toEqual([]);
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(sent.saved).toHaveLength(1));
    expect(sent.saved[0]?.parent_id).toBe(sales.id);
    expect(sent.saved[0]?.cells[1]?.source).toBe("MIN = 100");
  });

  it("adds a Markdown cell and renders it when it is run", async () => {
    withApi();
    renderWithApi(<NotebooksPage />);
    await screen.findByRole("heading", { name: "Sales Analysis Notebook" });
    await userEvent.click(screen.getByRole("button", { name: "Markdown" }));
    await userEvent.type(cell(2), "## Findings{Shift>}{Enter}{/Shift}");
    expect(await screen.findByRole("heading", { name: "Findings" })).toBeInTheDocument();
  });

  it("a new notebook is saved before it can run", async () => {
    const sent = withApi();
    useSelection.setState({ pipelineVersionId: pipeline.id });
    renderWithApi(<NotebooksPage />);
    await screen.findByRole("heading", { name: "Sales Analysis Notebook" });
    await userEvent.click(screen.getByRole("button", { name: "New notebook" }));
    await waitFor(() => expect(sent.saved).toHaveLength(1));
    expect(sent.saved[0]?.parent_id).toBeUndefined();
    expect(sent.saved[0]?.cells.map((c) => c.kind)).toEqual(["code"]);
    // A new notebook joins the flow on screen.
    expect(sent.saved[0]?.pipeline_version_id).toBe(pipeline.id);
  });

  it("lists only the notebooks of the flow on screen", async () => {
    withApi();
    const elsewhere = { ...sales, notebook_id: "nb_01JAAAAAAAAAAAAAAAAAAAAAAZ", id: "nbv_01JAAAAAAAAAAAAAAAAAAAAAAZ", title: "Other flow's notebook", pipeline_version_id: "plv_01JAAAAAAAAAAAAAAAAAAAAAAZ" };
    server.use(http.get("/api/notebooks", () => HttpResponse.json([elsewhere, sales])));
    useSelection.setState({ pipelineVersionId: pipeline.id });
    renderWithApi(<NotebooksPage />);
    const list = await screen.findByRole("navigation", { name: "Notebooks" });
    await within(list).findByRole("button", { name: "Sales analysis" });
    expect(within(list).queryByRole("button", { name: "Other flow's notebook" })).toBeNull();
  });

  it("lists notebooks made before flows had notebooks apart; saving one adds it to the flow on screen", async () => {
    const sent = withApi();
    const { pipeline_version_id: _, ...unlinked } = sales;
    server.use(http.get("/api/notebooks", () => HttpResponse.json([unlinked])));
    useSelection.setState({ pipelineVersionId: pipeline.id });
    renderWithApi(<NotebooksPage />);
    const loose = await screen.findByRole("list", { name: "Not in a flow yet" });
    await userEvent.click(within(loose).getByRole("button", { name: "Sales analysis" }));
    await userEvent.click(await screen.findByRole("button", { name: "Saved" }));
    await waitFor(() => expect(sent.versions).toHaveLength(1));
    expect(sent.saved.at(-1)?.pipeline_version_id).toBe(sent.versions[0]?.id ?? pipeline.id);
  });

  it("Save rebuilds the notebook's steps in its flow and shows that flow", async () => {
    const sent = withApi();
    useSelection.setState({ pipelineVersionId: pipeline.id });
    renderWithApi(<NotebooksPage />);
    await userEvent.type(await screen.findByRole("textbox", { name: "Cell 2" }), "0");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(sent.versions).toHaveLength(1));
    expect(sent.saved[0]).toMatchObject({ parent_id: sales.id, pipeline_version_id: pipeline.id });
    expect(sent.split[0]).toEqual({ cells: ["MIN = 100", "customers = load()", "eligible = customers[customers.n >= MIN]", "eligible.describe()"] });
    const flow = sent.versions[0]!;
    expect(flow.parent_id).toBe(pipeline.id);
    const mine = flow.nodes.filter((n) => n.from_notebook?.notebook_id === NB);
    expect(mine.map((n) => n.from_notebook?.cells)).toEqual([["params"], ["load"], ["filter"], ["show"]]);
    expect(mine.every((n) => n.from_notebook?.notebook_version_id === sent.saved[0]!.id)).toBe(true);
    await waitFor(() => expect(useSelection.getState().pipelineVersionId).toBe(flow.id));
    expect(await screen.findByText("Flow updated: 4 steps from this notebook.")).toBeInTheDocument();
  });

  it("Run All runs the cells and brings the flow up to date", async () => {
    const sent = withApi();
    useSelection.setState({ pipelineVersionId: pipeline.id });
    renderWithApi(<NotebooksPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Run All" }));
    await waitFor(() => expect(sent.executed).toHaveLength(4));
    await waitFor(() => expect(sent.versions).toHaveLength(1));
  });

  it("a step's code edited on the canvas comes back into its cell", async () => {
    const sent = withApi();
    const edited: PipelineVersion = {
      ...pipeline,
      nodes: [
        ...pipeline.nodes,
        { id: "sales_2", operator: "sprisk.code.python@2.0.0", params: { source: "customers = load(fresh=True)", outputs: ["customers"] }, from_notebook: { notebook_version_id: sales.id, notebook_id: NB, cells: ["load"] } },
      ],
    };
    server.use(http.get("/api/pipeline_versions", () => HttpResponse.json([edited])));
    useSelection.setState({ pipelineVersionId: pipeline.id });
    renderWithApi(<NotebooksPage />);
    await waitFor(() => expect(sent.saved).toHaveLength(1));
    expect(sent.saved[0]?.cells.find((c) => c.id === "load")?.source).toBe("customers = load(fresh=True)");
    expect(await screen.findByRole("textbox", { name: "Cell 3" })).toHaveValue("customers = load(fresh=True)");
    expect(sent.versions).toEqual([]);
  });
});
