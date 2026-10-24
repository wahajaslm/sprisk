import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FlowCanvas } from "../src/views/FlowCanvas.tsx";
import { useSelection } from "../src/workbench/selection.ts";
import { PV, RUN, run } from "./fixtures.ts";
import { renderWithApi } from "./render.tsx";
import { server } from "./server.ts";

const NEW_RUN = "run_01JABCDEFGHJKMNPQRSTVWXYZ8";

describe("a step's own actions on the canvas", () => {
  beforeEach(() => useSelection.setState({ pipelineVersionId: PV, runId: RUN, nodeId: undefined }));

  it("Run from here reuses the finished steps of the run on screen, then shows the new run", async () => {
    let sent: Record<string, unknown> | undefined;
    server.use(
      http.post("/api/runs", async ({ request }) => {
        sent = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ...run, id: NEW_RUN }, { status: 202 });
      }),
    );
    renderWithApi(<FlowCanvas />);

    await userEvent.click(await screen.findByRole("button", { name: "Run from impute" }));

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
