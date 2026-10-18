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
        links: [],
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
    renderWithApi(<NotebooksPage />);
    await screen.findByRole("heading", { name: "Sales Analysis Notebook" });
    await userEvent.click(screen.getByRole("button", { name: "New notebook" }));
    await waitFor(() => expect(sent.saved).toHaveLength(1));
    expect(sent.saved[0]?.parent_id).toBeUndefined();
    expect(sent.saved[0]?.cells.map((c) => c.kind)).toEqual(["code"]);
  });

  it("creates a node from picked cells: Python proposes, a non-table output is refused, the flow gets the node", async () => {
    const sent = withApi();
    server.use(http.get("/api/pipeline_versions", () => HttpResponse.json([{ ...pipeline, nodes: [...pipeline.nodes, { id: "customers", operator: "sprisk.code.python@2.0.0", params: { source: "customers = load()", outputs: ["customers"] } }] }])));
    useSelection.setState({ pipelineVersionId: pipeline.id });
    renderWithApi(<NotebooksPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Run cell 4" }));
    await userEvent.click(screen.getByRole("group", { name: "Cell 4" }));
    await userEvent.click(screen.getByRole("button", { name: "Create node from cells" }));

    const dialog = await screen.findByRole("dialog", { name: "Create node" });
    expect(sent.split[0]).toEqual({ cells: ["MIN = 10", "customers = load()", "eligible = customers[customers.n >= MIN]", "eligible.describe()"], together: { first: 2, last: 2 } });
    expect(within(dialog).getByText("customers ← customers.customers")).toBeInTheDocument();
    expect(within(dialog).getByRole("checkbox", { name: "MIN = 10" })).not.toBeChecked();
    expect(within(dialog).getByRole("checkbox", { name: "eligible" })).toBeChecked();
    const model = within(dialog).getByRole("checkbox", { name: "model" });
    expect(model).toBeDisabled();
    expect(within(dialog).getByText(/model is a sklearn.LogisticRegression, not a table/)).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole("checkbox", { name: "MIN = 10" }));
    await userEvent.clear(within(dialog).getByRole("textbox", { name: "Node name" }));
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Node name" }), "eligible");
    await userEvent.click(within(dialog).getByRole("button", { name: "Create node" }));

    await waitFor(() => expect(sent.versions).toHaveLength(1));
    const node = sent.versions[0]?.nodes.at(-1);
    expect(node?.params).toEqual({ source: "MIN = 10\neligible = customers[customers.n >= MIN]", inputs: ["customers"], outputs: ["eligible"], parameters: { MIN: 10 } });
    expect(node?.from_notebook).toEqual({ notebook_version_id: sales.id, cells: ["filter"] });
    expect(sent.versions[0]?.edges.at(-1)).toEqual({ from: "customers.customers", to: "eligible.customers" });
    await waitFor(() => expect(useSelection.getState().nav).toBe("Flow"));
    expect(useSelection.getState().pipelineVersionId).toBe(sent.versions[0]?.id);
  });

  it("Shift+click picks a range of cells for one node", async () => {
    const sent = withApi();
    renderWithApi(<NotebooksPage />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("group", { name: "Cell 3" }));
    await user.keyboard("{Shift>}");
    await user.click(screen.getByRole("group", { name: "Cell 4" }));
    await user.keyboard("{/Shift}");
    await user.click(screen.getByRole("button", { name: "Create node from cells" }));
    const dialog = await screen.findByRole("dialog", { name: "Create node" });
    expect(sent.split[0]).toMatchObject({ together: { first: 1, last: 2 } });
    expect(await within(dialog).findByText("Cell 3 has not run in this session.")).toBeInTheDocument();
  });
});
