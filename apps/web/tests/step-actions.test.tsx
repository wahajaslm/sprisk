import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FlowCanvas } from "../src/views/FlowCanvas.tsx";
import { useCanvasDetail } from "../src/workbench/detail.ts";
import { useSelection } from "../src/workbench/selection.ts";
import { attempts, PV, RUN, run } from "./fixtures.ts";
import { renderWithApi } from "./render.tsx";
import { server } from "./server.ts";

const NEW_RUN = "run_01JABCDEFGHJKMNPQRSTVWXYZ8";

describe("a step's own actions on the canvas", () => {
  beforeEach(() => useSelection.setState({ pipelineVersionId: PV, runId: RUN, nodeId: undefined }));

  it("a step's run button reuses the finished steps of the run on screen, then shows the new run", async () => {
    let sent: Record<string, unknown> | undefined;
    server.use(
      http.post("/api/runs", async ({ request }) => {
        sent = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ...run, id: NEW_RUN }, { status: 202 });
      }),
    );
    renderWithApi(<FlowCanvas />);

    const [first] = await screen.findAllByRole("button", { name: "Run steps not done" });
    await userEvent.click(first!);

    await waitFor(() => expect(sent).toEqual({ pipeline_version_id: PV, reuse_run_id: RUN }));
    await waitFor(() => expect(useSelection.getState().runId).toBe(NEW_RUN));
  });

  it("a step others read is not deleted: the canvas says why, with no pop-up and nothing saved", async () => {
    const alert = vi.spyOn(window, "alert").mockImplementation(() => undefined);
    let saved = 0;
    server.use(
      http.post("/api/pipeline_versions", () => {
        saved += 1;
        return HttpResponse.json({}, { status: 201 });
      }),
    );
    renderWithApi(<FlowCanvas />);

    const deleteSplit = await screen.findByRole("button", { name: "Delete split" });
    expect(deleteSplit).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(screen.getByRole("button", { name: /^split,/ }));
    fireEvent.keyDown(document.body, { key: "Delete" });

    expect(await screen.findByRole("alert")).toHaveTextContent("split is read by impute: remove those first.");
    expect(alert).not.toHaveBeenCalled();
    expect(saved).toBe(0);
    alert.mockRestore();
  });

  it("a delete that fails to save shows the API's error", async () => {
    server.use(
      http.post("/api/pipeline_versions", () =>
        HttpResponse.json({ errors: [{ code: "internal", message: "disk full" }] }, { status: 500 }),
      ),
    );
    renderWithApi(<FlowCanvas />);

    await userEvent.click(await screen.findByRole("button", { name: "Delete profile" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("disk full");
  });
});

describe("a compact step on the canvas", () => {
  beforeEach(() => {
    useSelection.setState({ pipelineVersionId: PV, runId: RUN, nodeId: undefined });
    useCanvasDetail.setState({ level: "compact" });
  });

  it("is two lines, as the design draws it: a failure takes the second line", async () => {
    server.use(
      http.get(`/api/runs/${RUN}/attempts`, () =>
        HttpResponse.json(attempts.map((a) => (a.node_id === "impute" ? { ...a, state: "failed" } : a))),
      ),
    );
    renderWithApi(<FlowCanvas />);

    const impute = await screen.findByRole("button", { name: /^impute,.*failed$/ });
    const lines = impute.querySelector(".round-text")!.children;
    expect(lines).toHaveLength(2);
    expect(within(lines[1] as HTMLElement).getByText("failed")).toBeInTheDocument();
  });
});
