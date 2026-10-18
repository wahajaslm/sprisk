import type { NotebookVersion } from "@sprisk/contracts";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";

import { ImportNotebook } from "../src/views/ImportNotebook.tsx";
import { TopBar } from "../src/views/TopBar.tsx";
import { useSelection } from "../src/workbench/selection.ts";
import { pipeline } from "./fixtures.ts";
import { renderWithApi } from "./render.tsx";
import { server } from "./server.ts";

function withApi() {
  const sent: { saved: NotebookVersion[]; runs: unknown[] } = { saved: [], runs: [] };
  server.use(
    http.post("/api/notebook_versions", async ({ request }) => {
      const body = (await request.json()) as NotebookVersion;
      sent.saved.push(body);
      return HttpResponse.json(body, { status: 201 });
    }),
    http.post("/api/notebooks/:id/execute", () => {
      sent.runs.push("execute");
      return HttpResponse.json({ status: "ok", outputs: [] });
    }),
  );
  return sent;
}

describe("import a notebook (ADR-0036)", () => {
  it("makes pasted cells a new notebook and opens it, without running anything", async () => {
    const sent = withApi();
    const onClose = vi.fn();
    renderWithApi(<ImportNotebook onClose={onClose} />);
    await userEvent.type(screen.getByRole("textbox", { name: "Cells" }), "# %%{enter}df = load(){enter}# %%{enter}n = len(df)");
    await userEvent.click(screen.getByRole("button", { name: "Import" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const [saved] = sent.saved;
    expect(saved?.parent_id).toBeUndefined();
    expect(saved?.cells.map((c) => [c.kind, c.source])).toEqual([
      ["code", "df = load()"],
      ["code", "n = len(df)"],
    ]);
    // Someone else's notebook runs only when the person runs its cells.
    expect(sent.runs).toEqual([]);
    expect(useSelection.getState()).toMatchObject({ nav: "Notebooks", notebookId: saved?.notebook_id });
  });

  it("keeps a .ipynb file's code and Markdown cells and names the notebook after the file", async () => {
    const sent = withApi();
    renderWithApi(<ImportNotebook onClose={() => {}} />);
    const notebook = JSON.stringify({ cells: [{ cell_type: "markdown", source: "# Sales" }, { cell_type: "code", source: ["a = 1"] }] });
    await userEvent.upload(screen.getByLabelText("Notebook file"), new File([notebook], "sales_analysis.ipynb"));
    expect(await screen.findByText("2 cells: 1 code, 1 Markdown.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Import" }));
    await waitFor(() => expect(sent.saved).toHaveLength(1));
    expect(sent.saved[0]?.title).toBe("sales_analysis");
    expect(sent.saved[0]?.cells.map((c) => c.kind)).toEqual(["markdown", "code"]);
  });

  it("shows why a file is not a notebook", async () => {
    withApi();
    renderWithApi(<ImportNotebook onClose={() => {}} />);
    await userEvent.upload(screen.getByLabelText("Notebook file"), new File(["{}"], "bad.ipynb"));
    expect(await screen.findByRole("alert")).toHaveTextContent("bad.ipynb is not a Jupyter notebook: it has no cells");
    expect(screen.getByRole("button", { name: "Import" })).toBeDisabled();
  });

  it("shows why the notebook could not be saved", async () => {
    server.use(http.post("/api/notebook_versions", () => HttpResponse.json({ errors: [{ code: "conflict", message: "conflict: UNIQUE" }] }, { status: 409 })));
    renderWithApi(<ImportNotebook onClose={() => {}} />);
    await userEvent.type(screen.getByRole("textbox", { name: "Cells" }), "a = 1");
    await userEvent.click(screen.getByRole("button", { name: "Import" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("conflict: UNIQUE");
  });

  it("opens from the flow menu", async () => {
    server.use(http.get("/api/pipeline_versions", () => HttpResponse.json([pipeline])));
    renderWithApi(<TopBar />);
    await userEvent.click(await screen.findByRole("button", { name: "Project and flow" }));
    await userEvent.click(screen.getByRole("button", { name: "Import notebook…" }));
    expect(screen.getByRole("dialog", { name: "Import notebook" })).toBeInTheDocument();
  });
});
