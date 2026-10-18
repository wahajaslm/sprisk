import type { NotebookVersion } from "@sprisk/contracts";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { OpenAsNotebook } from "../src/views/notebook/OpenAsNotebook.tsx";
import { useSelection } from "../src/workbench/selection.ts";
import { PV } from "./fixtures.ts";
import { renderWithApi } from "./render.tsx";
import { server } from "./server.ts";

describe("open a flow as a notebook (ADR-0036)", () => {
  it("makes a new notebook from the flow's code and opens it; the flow is unchanged", async () => {
    const saved: NotebookVersion[] = [];
    const flows: unknown[] = [];
    server.use(
      http.get("/api/operators/:id/source", ({ params }) =>
        HttpResponse.json({ operator: params.id, path: "m.py", language: "python", text: `def f(data):\n    return data  # ${String(params.id)}`, digest: `sha256:${"0".repeat(64)}` }),
      ),
      http.post("/api/notebook_versions", async ({ request }) => {
        const body = (await request.json()) as NotebookVersion;
        saved.push(body);
        return HttpResponse.json(body, { status: 201 });
      }),
      http.post("/api/pipeline_versions", async ({ request }) => {
        flows.push(await request.json());
        return HttpResponse.json({}, { status: 201 });
      }),
    );
    useSelection.setState({ pipelineVersionId: PV });
    renderWithApi(<OpenAsNotebook />);
    await userEvent.click(await screen.findByRole("button", { name: "Open as notebook" }));

    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]?.title).toBe(`Flow ${PV}`);
    expect(saved[0]?.cells[0]?.kind).toBe("markdown");
    expect(saved[0]?.cells.some((c) => c.kind === "code" && c.source.includes("sprisk.io.file_source@1.0.0"))).toBe(true);
    expect(flows).toEqual([]);
    expect(useSelection.getState()).toMatchObject({ nav: "Notebooks", notebookId: saved[0]?.notebook_id });
  });
});
