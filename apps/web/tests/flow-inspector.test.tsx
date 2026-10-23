import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { FlowInspector } from "../src/views/flow/FlowInspector.tsx";
import { useSelection } from "../src/workbench/selection.ts";
import { PV, RUN } from "./fixtures.ts";
import { renderWithApi } from "./render.tsx";

const FAKE = ["Missing data treatment strategy", "31.2% · umami_score", "Drop columns ≥ threshold", "Rule details"];

describe("FlowInspector", () => {
  beforeEach(() => useSelection.setState({ pipelineVersionId: PV, runId: RUN, nodeId: undefined }));

  it("asks for a step before showing checks, and never shows a made-up rule", () => {
    renderWithApi(<FlowInspector />);

    expect(screen.getByText("Select a step in the flow to inspect its methodology.")).toBeInTheDocument();
    for (const fake of FAKE) expect(screen.queryByText(fake)).not.toBeInTheDocument();
  });

  it("shows the selected step's real checks", async () => {
    useSelection.setState({ nodeId: "model" });
    renderWithApi(<FlowInspector />);

    expect(await screen.findByText(/No methodology (run for this flow yet|check concerns this step)\./)).toBeInTheDocument();
    for (const fake of FAKE) expect(screen.queryByText(fake)).not.toBeInTheDocument();
  });
});
