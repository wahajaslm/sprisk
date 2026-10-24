import type { FlowDecisions, PipelineVersion } from "@sprisk/contracts";
import { screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import groupSplit from "../../../tests/contract/flow_decisions/valid/group-split.json";
import { MethodologyTab } from "../src/views/inspector/MethodologyTab.tsx";
import { renderWithApi } from "./render.tsx";
import { server } from "./server.ts";

const decided = groupSplit as FlowDecisions;
const pipeline: PipelineVersion = {
  schema_version: "sprisk.pipeline_version/v1",
  id: decided.pipeline_version_id,
  project_id: "prj_01JABCDEFGHJKMNPQRSTVWXYZ0",
  nodes: [
    { id: "split", operator: "sprisk.validation.group_split@1.0.0", params: {} },
    { id: "model", operator: "sprisk.ml.linear_model@1.0.0", params: {} },
  ],
  edges: [],
  created_at: "2026-10-24T10:00:00Z",
};

function render(nodeId: string, decisions: FlowDecisions = decided) {
  server.use(
    http.get("/api/methodology_rules", () => HttpResponse.json([])),
    http.get(`/api/pipeline_versions/${pipeline.id}/decisions`, () => HttpResponse.json(decisions)),
  );
  renderWithApi(<MethodologyTab pipeline={pipeline} nodeId={nodeId} checks={{ status: "none" }} />);
}

describe("a method's decision on a step (ADR-0063)", () => {
  it("shows the method's question, the option it took, why, and how it was taken", async () => {
    render("split");
    const panel = await screen.findByRole("region", { name: "Fair evaluation" });
    expect(within(panel).getByText("How are rows divided into training and test so the score is fair?")).toBeInTheDocument();
    expect(within(panel).getByText("Chooses: Keep each item's rows on one side")).toBeInTheDocument();
    expect(within(panel).getByText(/no item is scored on rows the model saw/)).toBeInTheDocument();
    expect(within(panel).getByText("Chosen by the method")).toBeInTheDocument();
  });

  it("shows each promise with its standing, and never a stale one as holding", async () => {
    render("split");
    const promise = await screen.findByRole("listitem", { name: "No item has rows in both train and test." });
    expect(within(promise).getByText("Stale")).toBeInTheDocument();
    expect(within(promise).queryByText("Holds")).not.toBeInTheDocument();
    expect(within(promise).getByText(/changed since it was checked|changed since this was checked/)).toBeInTheDocument();
  });

  it("says a promise holds when its last check passed and nothing changed", async () => {
    const holding = structuredClone(decided);
    const promise = holding.decisions[1]!.promises[0]!;
    promise.status = "pass";
    promise.detail = "No item is in both sides (332 train, 83 test items).";
    delete promise.last_result;
    render("split", holding);
    const item = await screen.findByRole("listitem", { name: "No item has rows in both train and test." });
    expect(within(item).getByText("Holds")).toBeInTheDocument();
  });

  it("shows nothing of a method on a step no method shaped", async () => {
    render("model");
    expect(await screen.findByText("No methodology rule decides this step.")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Fair evaluation" })).not.toBeInTheDocument();
  });
});
