import { parse, type PipelineVersion } from "@sprisk/contracts";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import scalingBeforeForest from "../../../tests/contract/decision_proposal/valid/scaling-before-forest.json";
import { SplitMethodology } from "../src/views/inspector/SplitMethodology.tsx";
import { renderWithApi } from "./render.tsx";
import { server } from "./server.ts";

const pipeline: PipelineVersion = {
  schema_version: "sprisk.pipeline_version/v1",
  id: "plv_01JABCDEFGHJKMNPQRSTVWXYZ0",
  project_id: "prj_01JABCDEFGHJKMNPQRSTVWXYZ0",
  question_version_id: "qv_01JABCDEFGHJKMNPQRSTVWXYZ0",
  nodes: [{ id: "scale", operator: "sprisk.clean.scale@1.0.0", params: { columns: ["age"], method: "z_score" } }],
  edges: [],
  created_at: "2026-10-19T10:00:00Z",
};

const proposal = parse("DecisionProposal", {
  ...scalingBeforeForest,
  alternatives: [
    ...scalingBeforeForest.alternatives,
    {
      id: "robust_scaling",
      label: "Robust Scaling (Median & IQR)",
      description: "Center using the median and scale using the IQR.",
      applicability: "applicable",
      reason: "Available.",
      effect: { kind: "replace_node", node_id: "scale", operator: "sprisk.clean.scale@1.0.0", params: { columns: ["age"], method: "robust" } },
    },
  ],
});

async function review() {
  server.use(http.post("/api/pipeline_versions/:id/methodology/proposals/:node", () => HttpResponse.json(proposal, { status: 201 })));
  renderWithApi(<SplitMethodology pipeline={pipeline} nodeId="scale" />);
  await userEvent.click(screen.getByRole("button", { name: "Review methodology choices" }));
}

describe("methodology choice preview", () => {
  it("says a removing choice takes the step out of the flow", async () => {
    await review();
    await userEvent.click(await screen.findByRole("radio", { name: /No Scaling Step/ }));
    expect(screen.getByText(/The steps after it read its inputs directly/)).toBeInTheDocument();
    expect(screen.queryByText(/Replace/)).not.toBeInTheDocument();
  });

  it("shows the operator and params a replacing choice puts in", async () => {
    await review();
    await userEvent.click(await screen.findByRole("radio", { name: /Robust Scaling/ }));
    expect(screen.getByText(/Replace/)).toBeInTheDocument();
    expect(screen.getByText(/"method": "robust"/)).toBeInTheDocument();
  });
});
