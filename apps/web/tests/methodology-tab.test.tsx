import type { PipelineVersion } from "@sprisk/contracts";
import { screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import shortlistRule from "../../../tests/contract/methodology_rule/valid/shortlist.json";
import { stepType } from "../src/flow/stages.ts";
import { MethodologyTab } from "../src/views/inspector/MethodologyTab.tsx";
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

describe("methodology on a step", () => {
  it("says what every step is and what it measured", async () => {
    const described = { ...model, description: "Fits a linear model on the training rows." };
    renderWithApi(<MethodologyTab pipeline={pipeline} nodeId="model" checks={{ status: "none" }} operator={described} />);
    expect(await screen.findByText("Fits a linear model on the training rows.")).toBeInTheDocument();
    expect(screen.getByText(stepType(pipeline.nodes[0]!, described))).toBeInTheDocument();
    expect(screen.getByText("Not run")).toBeInTheDocument();
    expect(screen.getByText("0 steps")).toBeInTheDocument();
  });

  it("says so when no method decided the step", async () => {
    renderWithApi(<MethodologyTab pipeline={pipeline} nodeId="model" checks={{ status: "none" }} />);
    expect(await screen.findByText("No method decided this step.")).toBeInTheDocument();
  });

  it("is no longer in the Parameters tab, which holds only the step's settings", async () => {
    server.use(http.get("/api/methodology_rules", () => HttpResponse.json([{ ...shortlistRule, applies_to: ["sprisk.ml.linear_model"] }])));
    renderWithApi(<ParametersTab pipeline={pipeline} nodeId="model" operator={model} found={{ status: "none", reason: "" }} />);
    await screen.findByLabelText(/target/);
    expect(screen.queryByRole("region", { name: shortlistRule.name })).not.toBeInTheDocument();
  });
});
