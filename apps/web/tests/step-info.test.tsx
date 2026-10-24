import { screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { StepLibrary } from "../src/views/StepLibrary.tsx";
import { useSelection } from "../src/workbench/selection.ts";
import { PV, RUN, pipeline } from "./fixtures.ts";
import { renderWithApi } from "./render.tsx";
import { server } from "./server.ts";

const decided = {
  ...pipeline,
  nodes: pipeline.nodes.map((n) => (n.id === "split" ? { ...n, methodology_decision_id: "mdc_01JABCDEFGHJKMNPQRSTVWXYZ0" } : n)),
};

async function typeOf(nodeId: string) {
  server.use(http.get("/api/pipeline_versions", () => HttpResponse.json([decided])));
  useSelection.setState({ pipelineVersionId: PV, runId: RUN, nodeId });
  renderWithApi(<StepLibrary />);
  const info = await screen.findByRole("region", { name: "Info" });
  return within(info);
}

describe("the Flow sidebar's Info on the selected step", () => {
  it("calls a step a method chose a Decision, as the design does", async () => {
    const info = await typeOf("split");
    expect(await info.findByText("Decision")).toBeInTheDocument();
  });

  it("calls an operator step as written by its kind", async () => {
    const info = await typeOf("load");
    expect(await info.findByText("Source")).toBeInTheDocument();
  });
});
