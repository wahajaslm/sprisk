import { parse, type PipelineVersion } from "@sprisk/contracts";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import encodingBeforeModel from "../../../tests/contract/decision_proposal/valid/encoding-before-model.json";
import scalingBeforeForest from "../../../tests/contract/decision_proposal/valid/scaling-before-forest.json";
import { SplitMethodology } from "../src/views/inspector/SplitMethodology.tsx";
import { useSelection } from "../src/workbench/selection.ts";
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
    {
      id: "clip_instead",
      label: "Clip Outliers Instead",
      description: "Clip extreme values rather than rescale.",
      applicability: "applicable",
      reason: "Available.",
      effect: { kind: "replace_node", node_id: "scale", operator: "sprisk.clean.clip_outliers@1.0.0", params: { columns: ["age"] } },
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

  it("shows the params a choice keeping the step's operator puts in, as a settings change", async () => {
    await review();
    await userEvent.click(await screen.findByRole("radio", { name: /Robust Scaling/ }));
    expect(screen.getByText(/Change the settings of/)).toBeInTheDocument();
    expect(screen.getByText(/"method": "robust"/)).toBeInTheDocument();
  });
});

describe("a replacing choice", () => {
  it("names the operator it puts in the step's place", async () => {
    await review();
    await userEvent.click(await screen.findByRole("radio", { name: /Clip Outliers Instead/ }));
    expect(screen.getByText(/Replace/)).toHaveTextContent("Replace scale with sprisk.clean.clip_outliers@1.0.0.");
  });
});

describe("an adding choice", () => {
  it("names the step it adds and the step it goes before (ADR-0057)", async () => {
    const model: PipelineVersion = { ...pipeline, nodes: [{ id: "model", operator: "sprisk.ml.random_forest@2.0.0", params: { target: "y", task: "classification" } }] };
    server.use(http.post("/api/pipeline_versions/:id/methodology/proposals/:node", () => HttpResponse.json(parse("DecisionProposal", encodingBeforeModel), { status: 201 })));
    renderWithApi(<SplitMethodology pipeline={model} nodeId="model" />);
    await userEvent.click(screen.getByRole("button", { name: "Review methodology choices" }));
    await userEvent.click(await screen.findByRole("radio", { name: /One-Hot Encoding/ }));
    expect(screen.getByText(/^Add/)).toHaveTextContent("Add categories (sprisk.clean.encode@1.0.0) before model.");
    expect(screen.getByText(/"purpose"/)).toBeInTheDocument();
    expect(screen.queryByText(/Replace/)).not.toBeInTheDocument();
  });
});

describe("a rule's panel", () => {
  it("asks for its own decision and previews a settings change on the same model", async () => {
    const asked: string[] = [];
    const model: PipelineVersion = { ...pipeline, nodes: [{ id: "model", operator: "sprisk.ml.random_forest@1.2.0", params: { target: "y", features: ["x"], task: "classification" } }] };
    const costs = { positive: "bad", false_negative: 5, false_positive: 1 };
    const threshold = parse("DecisionProposal", {
      ...scalingBeforeForest,
      rule: "methodology.supervised.decision_threshold@1.0.0",
      subject_node_id: "model",
      recommended_alternative_id: "cost_optimal_threshold",
      alternatives: [{
        id: "cost_optimal_threshold", label: "Cost-Optimal Threshold", description: "Tuned for least cost.",
        applicability: "applicable", reason: "Costs are stated.",
        effect: { kind: "replace_node", node_id: "model", operator: "sprisk.ml.random_forest@1.2.0", params: { ...model.nodes[0]!.params, costs } },
      }],
    });
    server.use(http.post("/api/pipeline_versions/:id/methodology/proposals/:node/:decides", ({ params }) => {
      asked.push(`${String(params.node)}/${String(params.decides)}`);
      return HttpResponse.json(threshold, { status: 201 });
    }));
    renderWithApi(<SplitMethodology pipeline={model} nodeId="model" rule={{ name: "Decision Threshold", decides: "evaluation.decision_threshold" }} />);
    await userEvent.click(screen.getByRole("button", { name: "Review methodology choices" }));
    await userEvent.click(await screen.findByRole("radio", { name: /Cost-Optimal Threshold/ }));
    expect(asked).toEqual(["model/evaluation.decision_threshold"]);
    expect(screen.getByRole("region", { name: "Decision Threshold" })).toBeInTheDocument();
    expect(screen.getByText(/Change the settings of/)).toBeInTheDocument();
    expect(screen.queryByText(/Replace/)).not.toBeInTheDocument();
  });
});

describe("model shortlist", () => {
  const modelPipeline: PipelineVersion = {
    ...pipeline,
    nodes: [{ id: "model", operator: "sprisk.ml.linear_model@1.0.0", params: { target: "y", features: ["age"], task: "classification" } }],
  };
  const forestEffect = { kind: "replace_node" as const, node_id: "model", operator: "sprisk.ml.random_forest@1.1.0", params: { target: "y", features: ["age"], task: "classification" } };
  const shortlist = parse("DecisionProposal", {
    schema_version: "sprisk.decision_proposal/v1",
    id: "mpr_01JABCDEFGHJKMNPQRSTVWXYZ0",
    rule: "methodology.supervised.model_baseline_selection@2.0.0",
    question_version_id: "qv_01JABCDEFGHJKMNPQRSTVWXYZ0",
    pipeline_version_id: pipeline.id,
    subject_node_id: "model",
    evidence: [],
    alternatives: [
      { id: "ml_dummy_baseline", label: "sprisk.ml.dummy_baseline@1.0.0", description: "Baseline.", applicability: "applicable", reason: "The floor.", effect: { ...forestEffect, operator: "sprisk.ml.dummy_baseline@1.0.0" } },
      { id: "ml_random_forest", label: "sprisk.ml.random_forest@1.1.0", description: "Forest.", applicability: "applicable", reason: "Left off: too few rows.", effect: forestEffect },
    ],
    shortlist: ["ml_dummy_baseline"],
    fingerprint: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    created_at: "2026-10-19T10:00:00Z",
  });

  it("tags the shortlisted models and asks why when one is chosen without comparing", async () => {
    server.use(http.post("/api/pipeline_versions/:id/methodology/proposals/:node", () => HttpResponse.json(shortlist, { status: 201 })));
    renderWithApi(<SplitMethodology pipeline={modelPipeline} nodeId="model" />);
    await userEvent.click(screen.getByRole("button", { name: "Review methodology choices" }));

    expect(await screen.findByText(/dummy_baseline@1.0.0 · shortlisted/)).toBeInTheDocument();
    expect(screen.queryByText(/random_forest@1.1.0 · shortlisted/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: /dummy_baseline/ }));
    expect(screen.getByLabelText(/Reason for choosing without comparing/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply to new flow version" })).toBeDisabled();
  });

  it("says Sprisk compares the shortlist itself and points to Experiments", async () => {
    useSelection.setState({ nav: "Flow" });
    server.use(http.post("/api/pipeline_versions/:id/methodology/proposals/:node", () => HttpResponse.json(shortlist, { status: 201 })));
    renderWithApi(<SplitMethodology pipeline={modelPipeline} nodeId="model" />);
    await userEvent.click(screen.getByRole("button", { name: "Review methodology choices" }));

    expect(await screen.findByText(/Sprisk cross-validates the shortlisted models on its own/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Compare shortlisted models" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "See the comparison" }));
    expect(useSelection.getState().nav).toBe("Experiments");
  });
});
