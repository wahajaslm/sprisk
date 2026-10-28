import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";

import { FlowCanvas } from "../src/views/FlowCanvas.tsx";
import { useSelection } from "../src/workbench/selection.ts";
import { renderWithApi } from "./render.tsx";
import { server } from "./server.ts";

describe("the pipeline canvas with no pipeline", () => {
  beforeEach(() => useSelection.setState({ pipelineVersionId: undefined, runId: undefined, nodeId: undefined, nav: "Flow" }));

  it("sends the person to the Objective page to start an auto run", async () => {
    server.use(http.get("/api/pipeline_versions", () => HttpResponse.json([])));
    renderWithApi(<FlowCanvas />);

    expect(await screen.findByText(/No pipeline yet\. State a question, then start an auto run\./)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Open Objective" }));

    expect(useSelection.getState().nav).toBe("Objective");
  });
});
