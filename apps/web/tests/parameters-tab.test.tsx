import type { PipelineVersion } from "@sprisk/contracts";
import { screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import shortlistRule from "../../../tests/contract/methodology_rule/valid/shortlist.json";
import { ParametersTab } from "../src/views/inspector/ParametersTab.tsx";
import { operators } from "./fixtures.ts";
import { renderWithApi } from "./render.tsx";
import { server } from "./server.ts";

const model = {
  ...operators.find((o) => o.id === "sprisk.ml.linear_model@1.0.0")!,
  params_schema: { type: "object", properties: { target: { type: "string" } } },
};
const pipeline: PipelineVersion = {
  schema_version: "sprisk.pipeline_version/v1",
  id: "plv_01JABCDEFGHJKMNPQRSTVWXYZ0",
  project_id: "prj_01JABCDEFGHJKMNPQRSTVWXYZ0",
  question_version_id: "qv_01JABCDEFGHJKMNPQRSTVWXYZ0",
  nodes: [{ id: "model", operator: model.id, params: { target: "y", features: ["x"], task: "classification" } }],
  edges: [],
  created_at: "2026-10-21T10:00:00Z",
};

function render(appliesTo: string[], status: "active" | "draft" = "active") {
  server.use(http.get("/api/methodology_rules", () => HttpResponse.json([{ ...shortlistRule, status, applies_to: appliesTo }])));
  renderWithApi(<ParametersTab pipeline={pipeline} nodeId="model" operator={model} found={{ status: "none", reason: "" }} />);
}

describe("methodology on a step", () => {
  it("is offered when an active rule decides the step's operator", async () => {
    render(["sprisk.ml.linear_model"]);
    expect(await screen.findByRole("button", { name: "Review methodology choices" })).toBeInTheDocument();
  });

  it("shows one panel per rule that decides the step, in workflow order, titled by the rule", async () => {
    const threshold = { ...shortlistRule, id: "methodology.supervised.decision_threshold@1.0.0", name: "Decision Threshold",
      stage: "evaluation", decides: "evaluation.decision_threshold", selection: undefined };
    server.use(http.get("/api/methodology_rules", () =>
      HttpResponse.json([threshold, { ...shortlistRule, applies_to: ["sprisk.ml.linear_model"] }].map((r) => ({ ...r, applies_to: ["sprisk.ml.linear_model"] })))));
    renderWithApi(<ParametersTab pipeline={pipeline} nodeId="model" operator={model} found={{ status: "none", reason: "" }} />);
    const panels = await screen.findAllByRole("region", { name: /Model Shortlist|Decision Threshold/ });
    expect(panels.map((p) => p.getAttribute("aria-label"))).toEqual(["Model Shortlist", "Decision Threshold"]);
  });

  it("is not offered when no active rule decides it", async () => {
    render(["sprisk.ml.random_forest"]);
    await screen.findByLabelText(/target/);
    expect(screen.queryByRole("button", { name: "Review methodology choices" })).not.toBeInTheDocument();
  });
});
