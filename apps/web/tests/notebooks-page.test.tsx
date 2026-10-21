import type { NotebookVersion, PipelineVersion } from "@sprisk/contracts";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { StrictMode } from "react";
import { describe, expect, it } from "vitest";

import { NotebooksPage } from "../src/views/notebook/NotebooksPage.tsx";
import { useSelection } from "../src/workbench/selection.ts";
import { pipeline } from "./fixtures.ts";
import { renderWithApi } from "./render.tsx";
import { server } from "./server.ts";

const NB = "nb_01JAAAAAAAAAAAAAAAAAAAAAAA";

const sales: NotebookVersion = {
  schema_version: "sprisk.notebook_version/v1",
  id: "nbv_01JAAAAAAAAAAAAAAAAAAAAAAB",
  notebook_id: NB,
  project_id: pipeline.project_id,
  title: "Sales analysis",
  cells: [{ id: "load", kind: "code", source: "customers = load()" }],
  pipeline_version_id: pipeline.id,
  created_at: "2026-10-18T12:00:00Z",
};

const other: NotebookVersion = { ...sales, id: "nbv_01JAAAAAAAAAAAAAAAAAAAAAAC", notebook_id: "nb_01JAAAAAAAAAAAAAAAAAAAAAAB", title: "Scratch" };

const fromSales = (cells: string[]) => ({ notebook_version_id: sales.id, notebook_id: NB, cells });

/** The flow with two steps made from the Sales notebook, the second reading the first. */
const flow: PipelineVersion = {
  ...pipeline,
  nodes: [
    ...pipeline.nodes,
    { id: "sales_1", operator: "sprisk.code.python@2.0.0", params: { source: "customers = load()", inputs: [], outputs: ["customers"] }, from_notebook: fromSales(["load"]) },
    { id: "sales_2", operator: "sprisk.code.python@2.0.0", params: { source: "customers.describe()", inputs: ["customers"], outputs: [] }, from_notebook: fromSales(["gone"]) },
  ],
  edges: [...pipeline.edges, { from: "sales_1.customers", to: "sales_2.customers" }],
};

function withApi(base: PipelineVersion = flow) {
  let listed = [sales, other];
  const posts: { path: string; body: NotebookVersion | PipelineVersion }[] = [];
  server.use(
    http.get("/api/pipeline_versions", () => HttpResponse.json([base])),
    http.get("/api/notebooks", () => HttpResponse.json(listed)),
    http.post("/api/notebook_versions", async ({ request }) => {
      const body = (await request.json()) as NotebookVersion;
      posts.push({ path: "notebook_versions", body });
      listed = listed.filter((v) => v.notebook_id !== body.notebook_id);
      if (!body.removed) listed = [body, ...listed];
      return HttpResponse.json(body, { status: 201 });
    }),
    http.post("/api/pipeline_versions", async ({ request }) => {
      const body = (await request.json()) as PipelineVersion;
      posts.push({ path: "pipeline_versions", body });
      return HttpResponse.json(body, { status: 201 });
    }),
  );
  return posts;
}

const list = () => screen.findByRole("list", { name: "This flow's notebooks" });

describe("renaming a notebook (ADR-0041)", () => {
  it("saves a version with the new title, the same cells and flow, and leaves the flow alone", async () => {
    const posts = withApi();
    renderWithApi(<NotebooksPage />);
    await userEvent.click(within(await list()).getByRole("button", { name: "Rename Sales analysis" }));
    const title = screen.getByRole("textbox", { name: "Title of Sales analysis" });
    await userEvent.clear(title);
    await userEvent.type(title, "Customer sales{Enter}");

    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]!.path).toBe("notebook_versions");
    expect(posts[0]!.body).toMatchObject({ notebook_id: NB, parent_id: sales.id, title: "Customer sales", cells: sales.cells, pipeline_version_id: sales.pipeline_version_id });
    expect(await within(await list()).findByRole("button", { name: "Customer sales" })).toBeInTheDocument();
  });

  it("Escape keeps the old title and saves nothing", async () => {
    const posts = withApi();
    renderWithApi(<NotebooksPage />);
    await userEvent.click(within(await list()).getByRole("button", { name: "Rename Sales analysis" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Title of Sales analysis" }), " draft{Escape}");

    expect(screen.queryByRole("textbox", { name: "Title of Sales analysis" })).not.toBeInTheDocument();
    expect(within(await list()).getByRole("button", { name: "Sales analysis" })).toHaveFocus();
    expect(posts).toEqual([]);
  });

  it("a blank title, or clicking away, saves nothing", async () => {
    const posts = withApi();
    renderWithApi(<NotebooksPage />);
    await userEvent.click(within(await list()).getByRole("button", { name: "Rename Sales analysis" }));
    await userEvent.clear(screen.getByRole("textbox", { name: "Title of Sales analysis" }));
    await userEvent.keyboard("   {Enter}");
    await userEvent.click(within(await list()).getByRole("button", { name: "Rename Sales analysis" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Title of Sales analysis" }), " draft");
    await userEvent.click(screen.getByRole("button", { name: "Scratch" }));

    expect(screen.queryByRole("textbox", { name: "Title of Sales analysis" })).not.toBeInTheDocument();
    expect(posts).toEqual([]);
  });

  it("shows why a rename failed and keeps the old title", async () => {
    withApi();
    server.use(http.post("/api/notebook_versions", () => HttpResponse.json({ errors: [{ code: "unknown_parent", message: "parent is gone" }] }, { status: 422 })));
    renderWithApi(<NotebooksPage />);
    await userEvent.click(within(await list()).getByRole("button", { name: "Rename Sales analysis" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Title of Sales analysis" }), " 2{Enter}");

    expect(await screen.findByRole("alert")).toHaveTextContent("parent is gone");
    expect(within(await list()).getByRole("button", { name: "Sales analysis" })).toBeInTheDocument();
  });
});

describe("deleting a notebook (ADR-0041)", () => {
  it("asks first, then saves the flow without its steps, then the removed notebook version", async () => {
    const posts = withApi();
    renderWithApi(<NotebooksPage />);
    await userEvent.click(within(await list()).getByRole("button", { name: "Delete Sales analysis" }));
    expect(posts).toEqual([]);
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(posts).toHaveLength(2));
    expect(posts.map((p) => p.path)).toEqual(["pipeline_versions", "notebook_versions"]);
    const saved = posts[0]!.body as PipelineVersion;
    expect(saved).toMatchObject({ parent_id: flow.id, nodes: pipeline.nodes, edges: pipeline.edges });
    expect(posts[1]!.body).toMatchObject({ notebook_id: NB, parent_id: sales.id, removed: true });
    await waitFor(() => expect(within(screen.getByRole("list", { name: "This flow's notebooks" })).queryByRole("button", { name: "Sales analysis" })).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Scratch" })).toHaveAttribute("aria-current", "true");
  });

  it("Cancel saves nothing", async () => {
    const posts = withApi();
    renderWithApi(<NotebooksPage />);
    await userEvent.click(within(await list()).getByRole("button", { name: "Delete Sales analysis" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
    expect(posts).toEqual([]);
  });

  it("is refused while another step reads the notebook's output, naming that step, and saves nothing", async () => {
    const read: PipelineVersion = {
      ...flow,
      nodes: [...flow.nodes, { id: "report", operator: "sprisk.code.python@2.0.0", params: { source: "", inputs: ["customers"] } }],
      edges: [...flow.edges, { from: "sales_1.customers", to: "report.customers" }],
    };
    const posts = withApi(read);
    renderWithApi(<NotebooksPage />);
    await userEvent.click(within(await list()).getByRole("button", { name: "Delete Sales analysis" }));

    expect(screen.getByRole("alert")).toHaveTextContent("report");
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
    expect(posts).toEqual([]);
  });

  it("deletes a notebook with no steps in the flow with one save", async () => {
    const posts = withApi();
    renderWithApi(<NotebooksPage />);
    await userEvent.click(within(await list()).getByRole("button", { name: "Delete Scratch" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(posts.map((p) => p.path)).toEqual(["notebook_versions"]));
    expect(posts[0]!.body).toMatchObject({ notebook_id: other.notebook_id, removed: true });
  });

  it("shows why a save failed and keeps the notebook listed", async () => {
    withApi();
    server.use(http.post("/api/pipeline_versions", () => HttpResponse.json({ errors: [{ code: "compile", message: "flow is broken" }] }, { status: 422 })));
    renderWithApi(<NotebooksPage />);
    await userEvent.click(within(await list()).getByRole("button", { name: "Delete Sales analysis" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("flow is broken");
    expect(within(await list()).getByRole("button", { name: "Sales analysis" })).toBeInTheDocument();
  });

  it("when the notebook's save fails after the flow's, deleting again saves only the notebook", async () => {
    const posts = withApi();
    let fail = true;
    server.use(
      http.post("/api/notebook_versions", () => {
        if (!fail) return;
        fail = false;
        return HttpResponse.json({ errors: [{ code: "store", message: "disk full" }] }, { status: 422 });
      }),
      http.get("/api/pipeline_versions", () => HttpResponse.json([...posts.filter((p) => p.path === "pipeline_versions").map((p) => p.body).reverse(), flow])),
    );
    renderWithApi(<NotebooksPage />);
    await userEvent.click(within(await list()).getByRole("button", { name: "Delete Sales analysis" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("disk full");
    expect(posts.map((p) => p.path)).toEqual(["pipeline_versions"]);

    await userEvent.click(within(await list()).getByRole("button", { name: "Delete Sales analysis" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(posts.map((p) => p.path)).toEqual(["pipeline_versions", "notebook_versions"]));
    expect(posts[1]!.body).toMatchObject({ notebook_id: NB, removed: true });
  });
});

describe("a flow's own notebook (ADR-0054)", () => {
  function noNotebooks(listed: NotebookVersion[] = []) {
    const posts = withApi(pipeline);
    server.use(
      http.get("/api/notebooks", () => HttpResponse.json(listed)),
      http.get("/api/operators/:id/source", ({ params }) =>
        HttpResponse.json({ operator: String(params.id), path: "m.py", language: "python", text: "def f():\n    pass\n", digest: `sha256:${"0".repeat(64)}` }),
      ),
    );
    useSelection.setState({ pipelineVersionId: pipeline.id, notebookId: undefined, stageTarget: undefined });
    return posts;
  }

  it("is made once for a flow with none, with each step's code", async () => {
    const posts = noNotebooks();
    renderWithApi(<StrictMode><NotebooksPage /></StrictMode>);
    await waitFor(() => expect(posts.length).toBeGreaterThan(0));
    await new Promise((resolve) => setTimeout(resolve, 50));
    const titles = posts.map((p) => (p.body as NotebookVersion).title);
    expect(new Set(titles).size).toBe(titles.length);
    const cells = posts.flatMap((p) => (p.body as NotebookVersion).cells);
    expect(cells.some((c) => c.source.startsWith("Code of `sprisk.ml.linear_model@1.0.0`"))).toBe(true);
    expect(posts.every((p) => (p.body as NotebookVersion).pipeline_version_id === pipeline.id)).toBe(true);
  });

  it("is not made, and says why, when a step's code cannot be read", async () => {
    const posts = noNotebooks();
    server.use(http.get("/api/operators/:id/source", () => HttpResponse.json({ errors: [{ code: "not_found", message: "no source" }] }, { status: 404 })));
    renderWithApi(<NotebooksPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("The flow's notebook was not made:");
    expect(posts).toEqual([]);
  });

  it("is not made when the flow has a notebook", async () => {
    const posts = noNotebooks([sales]);
    renderWithApi(<NotebooksPage />);
    await list();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(posts).toEqual([]);
  });
});
