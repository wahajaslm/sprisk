import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";

import { TopBar } from "../src/views/TopBar.tsx";
import { ImportNotebook } from "../src/views/ImportNotebook.tsx";
import { useSelection } from "../src/workbench/selection.ts";
import { pipeline, run } from "./fixtures.ts";
import { renderWithApi } from "./render.tsx";
import { server } from "./server.ts";

const split = {
  steps: [
    { source: "df = load()", cells: [0], inputs: [], outputs: ["df"] },
    { source: "n = len(df)", cells: [1], inputs: ["df"], outputs: [] },
  ],
  links: [{ from_step: 0, to_step: 1, name: "df" }],
  notes: [{ cell: 0, message: "cell 1 reads load, which no earlier cell sets" }],
};

function withApi() {
  const sent: { cells?: unknown; versions: { nodes: { id: string }[]; edges: unknown[] }[]; runs: unknown[] } = { versions: [], runs: [] };
  server.use(
    http.post("/api/code/split", async ({ request }) => {
      sent.cells = ((await request.json()) as { cells: unknown }).cells;
      return HttpResponse.json(split);
    }),
    http.post("/api/pipeline_versions", async ({ request }) => {
      const body = (await request.json()) as (typeof sent.versions)[number];
      sent.versions.push(body);
      return HttpResponse.json(body, { status: 201 });
    }),
    http.post("/api/runs", async ({ request }) => {
      sent.runs.push(await request.json());
      return HttpResponse.json({ ...run, id: "run_01JABCDEFGHJKMNPQRSTVWXYZ9" }, { status: 202 });
    }),
  );
  return sent;
}

describe("import a notebook (ADR-0031)", () => {
  it("reads pasted cells, shows the steps and links, then creates and runs the flow", async () => {
    const sent = withApi();
    const onClose = vi.fn();
    renderWithApi(<ImportNotebook onClose={onClose} />);
    await userEvent.type(screen.getByRole("textbox", { name: "Cells" }), "# %%{enter}df = load(){enter}# %%{enter}n = len(df)");
    await userEvent.click(screen.getByRole("button", { name: "Read cells" }));

    const steps = await screen.findByRole("list", { name: "Steps" });
    expect(sent.cells).toEqual(["df = load()", "n = len(df)"]);
    expect(within(steps).getAllByRole("listitem")[1]).toHaveTextContent("reads df from step 1");
    expect(within(steps).getAllByRole("listitem")[0]).toHaveTextContent("passes on df");
    expect(screen.getByText("cell 1 reads load, which no earlier cell sets")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Create flow" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const [version] = sent.versions;
    expect(version?.nodes.map((n) => n.id)).toEqual(["cell_1", "cell_2"]);
    expect(version?.edges).toEqual([{ from: "cell_1.df", to: "cell_2.df" }]);
    expect(sent.runs).toEqual([{ pipeline_version_id: expect.stringMatching(/^plv_/) }]);
    expect(useSelection.getState()).toMatchObject({ runId: "run_01JABCDEFGHJKMNPQRSTVWXYZ9", nodeId: "cell_1" });
  });

  it("reads the code cells of a .ipynb file", async () => {
    const sent = withApi();
    renderWithApi(<ImportNotebook onClose={() => {}} />);
    const notebook = JSON.stringify({ cells: [{ cell_type: "code", source: ["a = 1"] }, { cell_type: "markdown", source: "x" }] });
    await userEvent.upload(screen.getByLabelText("Notebook file"), new File([notebook], "a.ipynb"));
    await userEvent.click(screen.getByRole("button", { name: "Read cells" }));
    await screen.findByRole("list", { name: "Steps" });
    expect(sent.cells).toEqual(["a = 1"]);
  });

  it("shows why a file is not a notebook", async () => {
    withApi();
    renderWithApi(<ImportNotebook onClose={() => {}} />);
    await userEvent.upload(screen.getByLabelText("Notebook file"), new File(["{}"], "bad.ipynb"));
    await userEvent.click(screen.getByRole("button", { name: "Read cells" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("bad.ipynb is not a Jupyter notebook: it has no cells");
  });

  it("opens from the flow menu", async () => {
    server.use(http.get("/api/pipeline_versions", () => HttpResponse.json([pipeline])));
    renderWithApi(<TopBar />);
    await userEvent.click(await screen.findByRole("button", { name: "Project and flow" }));
    await userEvent.click(screen.getByRole("button", { name: "Import notebook…" }));
    expect(screen.getByRole("dialog", { name: "Import notebook" })).toBeInTheDocument();
  });
});
