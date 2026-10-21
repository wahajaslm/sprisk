import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import appliedDecision from "../../../tests/contract/applied_methodology_decision/valid/applied.json";
import seenDecision from "../../../tests/contract/methodology_decision/valid/second-branch-of-a-comparison.json";
import shortlistRule from "../../../tests/contract/methodology_rule/valid/shortlist.json";
import noWinner from "../../../tests/contract/selection_decision/valid/no-winner-with-limitations.json";
import tested from "../../../tests/contract/selection_decision/valid/tested.json";
import winner from "../../../tests/contract/selection_decision/valid/winner.json";
import { Experiments } from "../src/views/Experiments.tsx";
import { useSelection } from "../src/workbench/selection.ts";
import { PV, RUN, attempts, pipeline, run, scoreAttempt, scoreOutputs } from "./fixtures.ts";
import { renderWithApi } from "./render.tsx";
import { server } from "./server.ts";

const PV2 = "plv_01JABCDEFGHJKMNPQRSTVWXYZ2";
const RUN2 = "run_01JABCDEFGHJKMNPQRSTVWXYZ2";
const edited = {
  ...pipeline,
  id: PV2,
  parent_id: PV,
  nodes: pipeline.nodes.map((n) => (n.id === "split" ? { ...n, params: { test_fraction: 0.25, seed: 7 } } : n)),
};
const run2 = { ...run, id: RUN2, pipeline_version_id: PV2, created_at: "2026-10-16T11:00:00Z" };
const score2 = { ...scoreAttempt, id: "att_01JABCDEFGHJKMNPQRSTVWXY60", run_id: RUN2 };
const metrics2 = { ...scoreOutputs[0]!, artifact: { ...scoreOutputs[0]!.artifact, id: "art_01JABCDEFGHJKMNPQRSTVWXY60" } };

function twoVersions() {
  server.use(
    http.get("/api/pipeline_versions", () => HttpResponse.json([edited, pipeline])),
    http.get("/api/runs", ({ request }) => {
      const pv = new URL(request.url).searchParams.get("pipeline_version_id");
      return HttpResponse.json(pv === PV2 ? [run2] : [run]);
    }),
    http.get(`/api/runs/${RUN2}/attempts`, () => HttpResponse.json([...attempts.filter((a) => a.node_id !== "score"), score2])),
    http.get(`/api/attempts/${score2.id}/outputs`, () => HttpResponse.json([metrics2])),
    http.get(`/api/artifacts/${metrics2.artifact.id}/content`, () => HttpResponse.text('{"accuracy": 0.9}')),
  );
  useSelection.setState({ pipelineVersionId: PV2, runId: RUN2 });
}

describe("experiments", () => {
  it("lists every run of the flow across its versions, with what changed and its metric", async () => {
    twoVersions();
    renderWithApi(<Experiments />);
    const table = await screen.findByRole("table", { name: "Runs" });
    expect(await screen.findByText("2 runs")).toBeInTheDocument();
    const rows = within(table).getAllByRole("row").slice(1);
    await waitFor(() => expect(rows[0]).toHaveTextContent("0.9"));
    expect(rows[0]).toHaveTextContent("split seed 42 → 7");
    expect(rows[1]).toHaveTextContent("0.947");
  });

  it("compares the two chosen runs: settings that differ and metrics side by side", async () => {
    twoVersions();
    renderWithApi(<Experiments />);
    const diff = await screen.findByRole("region", { name: "Settings that differ" });
    await waitFor(() => expect(diff).toHaveTextContent("split · seed"));
    expect(diff).toHaveTextContent("42");
    expect(diff).toHaveTextContent("7");
    const metrics = screen.getByRole("region", { name: "Metrics" });
    await waitFor(() => expect(metrics).toHaveTextContent("0.947"));
    expect(metrics).toHaveTextContent("0.9");
    expect(metrics).toHaveTextContent("▼ 0.047");
  });

  it("opens a run in the Flow view", async () => {
    twoVersions();
    renderWithApi(<Experiments />);
    const table = await screen.findByRole("table", { name: "Runs" });
    await userEvent.click(within(table).getAllByRole("button", { name: "Open in Flow" })[1]!);
    expect(useSelection.getState()).toMatchObject({ nav: "Flow", pipelineVersionId: PV, runId: RUN });
  });

  it("says so when the flow has fewer than two runs to compare", async () => {
    useSelection.setState({ pipelineVersionId: PV, runId: RUN });
    renderWithApi(<Experiments />);
    expect(await screen.findByText(/Run the flow again/)).toBeInTheDocument();
  });
});

describe("comparison cautions", () => {
  it("warns that a changed split means different test rows, and how much one row moves a metric", async () => {
    twoVersions();
    renderWithApi(<Experiments />);
    const metrics = await screen.findByRole("region", { name: "Metrics" });
    expect(await within(metrics).findByText(/split changed, so the two runs were scored on different test rows/)).toBeInTheDocument();
    await waitFor(() => expect(metrics).toHaveTextContent("One test row moves accuracy by about 0.026"));
  });
});

describe("model comparison", () => {
  const MPR = "mpr_01JABCDEFGHJKMNPQRSTVWXYZ0";
  const CPV = "plv_01JABCDEFGHJKMNPQRSTVWXYZ8";
  const CRUN = "run_01JABCDEFGHJKMNPQRSTVWXYZ8";
  const comparison = {
    ...pipeline,
    id: CPV,
    compares: MPR,
    nodes: [...pipeline.nodes.filter((n) => n.id === "load" || n.id === "split"), { id: "select_model", operator: "sprisk.ml.select_model@2.0.0", params: {} }],
  };
  const comparisonRun = { ...run, id: CRUN, pipeline_version_id: CPV };
  const selectAttempt = { ...scoreAttempt, id: "att_01JABCDEFGHJKMNPQRSTVWXY80", run_id: CRUN, node_id: "select_model" };
  const decisionOutput = {
    port: "decision",
    artifact: { ...scoreOutputs[0]!.artifact, id: "art_01JABCDEFGHJKMNPQRSTVWXY80", producer_attempt_id: selectAttempt.id },
  };
  const proposal = {
    schema_version: "sprisk.decision_proposal/v1",
    id: MPR,
    rule: "methodology.supervised.model_baseline_selection@2.0.0",
    question_version_id: "qv_01JABCDEFGHJKMNPQRSTVWXYZ0",
    pipeline_version_id: PV,
    subject_node_id: "model",
    evidence: [],
    alternatives: [
      { id: "ml_dummy_baseline", label: "sprisk.ml.dummy_baseline@1.0.0", description: "Dummy.", applicability: "applicable", reason: "The floor." },
      { id: "ml_linear_model", label: "sprisk.ml.linear_model@1.0.0", description: "Linear.", applicability: "applicable", reason: "A simple reference." },
      { id: "ml_random_forest", label: "sprisk.ml.random_forest@1.0.0", description: "Forest.", applicability: "applicable", reason: "Enough rows for trees." },
      { id: "ml_gradient_boosting", label: "sprisk.ml.gradient_boosting@1.0.0", description: "Boosting.", applicability: "applicable", reason: "Too few rows to trust." },
    ],
    shortlist: ["ml_dummy_baseline", "ml_linear_model", "ml_random_forest"],
    fingerprint: `sha256:${"0".repeat(64)}`,
    created_at: "2026-10-19T10:00:00Z",
  };

  function compared(decision: object) {
    const applied: unknown[] = [];
    server.use(
      http.get("/api/pipeline_versions", () => HttpResponse.json([comparison, pipeline])),
      http.get(`/api/methodology_proposals/${MPR}`, () => HttpResponse.json(proposal)),
      http.get("/api/runs", ({ request }) =>
        HttpResponse.json(new URL(request.url).searchParams.get("pipeline_version_id") === CPV ? [comparisonRun] : [run]),
      ),
      http.get(`/api/runs/${CRUN}/attempts`, () => HttpResponse.json([selectAttempt])),
      http.get(`/api/attempts/${selectAttempt.id}/outputs`, () => HttpResponse.json([decisionOutput])),
      http.get(`/api/artifacts/${decisionOutput.artifact.id}/content`, () => HttpResponse.text(JSON.stringify(decision))),
      http.post(`/api/methodology_proposals/${MPR}/apply`, async ({ request }) => {
        applied.push(await request.json());
        return HttpResponse.json(appliedDecision, { status: 201 });
      }),
    );
    useSelection.setState({ pipelineVersionId: PV, runId: RUN });
    renderWithApi(<Experiments />);
    return applied;
  }

  const row = (table: HTMLElement, label: string) => within(table).getByRole("row", { name: new RegExp(`^${label}`) });

  it("shows every model side by side: why it was shortlisted, its scores, gain and verdict", async () => {
    compared(winner);
    const region = await screen.findByRole("region", { name: "Model comparison" });
    const table = await within(region).findByRole("table", { name: "Candidates" });
    expect(region).toHaveTextContent("5-fold cross-validation, seed 0, scored by balanced accuracy");
    expect(region).toHaveTextContent("the test rows were not used");
    expect(within(table).getAllByRole("columnheader")[2]).toHaveTextContent("ml_linear_modelrecommended");
    expect(row(table, "Why on the shortlist")).toHaveTextContent("The floor.A simple reference.Enough rows for trees.");
    expect(row(table, "Mean ± spread")).toHaveTextContent("0.5 ± 0" + "0.898 ± 0.0238");
    expect(row(table, "Fold scores")).toHaveTextContent("5 scores, 0.87 to 0.93");
    expect(row(table, "Gain over baseline")).toHaveTextContent("+0.398 ± 0.0145");
    expect(row(table, "Verdict")).toHaveTextContent("the floorrecommendedclears the 1-SE bar");
    expect(region).toHaveTextContent("Left off the shortlist: ml_gradient_boosting (Too few rows to trust.)");
    expect(region).toHaveTextContent(winner.reason);
    // A comparison is not a run of the flow.
    expect(screen.getByText("1 run")).toBeInTheDocument();
  });

  it("uses the recommended model with no reason asked", async () => {
    const applied = compared(winner);
    await userEvent.click(await screen.findByRole("button", { name: "Use ml_linear_model" }));
    await userEvent.click(screen.getByRole("button", { name: "Apply ml_linear_model to a new version" }));
    await waitFor(() => expect(applied).toHaveLength(1));
    expect(applied[0]).toMatchObject({ alternative_id: "ml_linear_model" });
    expect(applied[0]).not.toHaveProperty("reason");
    await waitFor(() => expect(useSelection.getState().pipelineVersionId).toBe(appliedDecision.pipeline.id));
  });

  it("uses another model only with a reason", async () => {
    const applied = compared(winner);
    await userEvent.click(await screen.findByRole("button", { name: "Use ml_random_forest" }));
    const apply = screen.getByRole("button", { name: "Apply ml_random_forest to a new version" });
    expect(apply).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Why ml_random_forest instead of the recommended ml_linear_model?"), "Need interactions.");
    await userEvent.click(apply);
    await waitFor(() => expect(applied).toHaveLength(1));
    expect(applied[0]).toMatchObject({ alternative_id: "ml_random_forest", reason: "Need interactions." });
  });

  it("opens the recommendation and the best other model side by side, and any two on request", async () => {
    compared(winner);
    const detail = await screen.findByRole("region", { name: "Detail" });
    expect(within(detail).getByRole("region", { name: "Detail of ml_linear_model" })).toHaveTextContent("Fold scores: 0.91 · 0.88 · 0.93 · 0.9 · 0.87");
    expect(within(detail).getByRole("region", { name: "Detail of ml_random_forest" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("checkbox", { name: "Compare ml_dummy_baseline in detail" }));
    const regions = within(screen.getByRole("region", { name: "Detail" })).getAllByRole("region").map((r) => r.getAttribute("aria-label"));
    expect(regions).toEqual(["Detail of ml_random_forest", "Detail of ml_dummy_baseline"]);
  });

  it("says when no model beats the baseline, recommends none and names what was left out", async () => {
    compared(noWinner);
    const region = await screen.findByRole("region", { name: "Model comparison" });
    expect(await within(region).findByText(noWinner.reason)).toBeInTheDocument();
    expect(region).toHaveTextContent(noWinner.limitations[0]!);
    const table = within(region).getByRole("table", { name: "Candidates" });
    expect(row(table, "Verdict")).toHaveTextContent("within 1 SE of baseline");
    expect(region).not.toHaveTextContent("recommended");
  });

  it("shows why a comparison cannot be shown when its proposal cannot be read", async () => {
    compared(winner);
    server.use(http.get(`/api/methodology_proposals/${MPR}`, () => HttpResponse.json({ errors: [{ code: "not_found", message: "gone" }] }, { status: 404 })));
    expect(await screen.findByRole("alert")).toHaveTextContent("A model comparison cannot be shown: not_found: gone");
  });

  it("calls a model clearly below the baseline worse, not within noise", async () => {
    const [floor, linear] = noWinner.candidates;
    compared({ ...noWinner, candidates: [floor, { ...linear, versus_baseline: { mean_difference: -0.2, corrected_se: 0.02, beats_baseline: false } }] });
    const table = await screen.findByRole("table", { name: "Candidates" });
    expect(row(table, "Verdict")).toHaveTextContent("worse than baseline");
  });

  it("says why a comparison run failed", async () => {
    compared(winner);
    const failed = { ...selectAttempt, state: "failed", error: { code: "invalid_input", message: "class 'rare' has 3 train rows" } };
    server.use(
      http.get("/api/runs", ({ request }) =>
        HttpResponse.json(new URL(request.url).searchParams.get("pipeline_version_id") === CPV ? [{ ...comparisonRun, status: "failed" }] : [run]),
      ),
      http.get(`/api/runs/${CRUN}/attempts`, () => HttpResponse.json([failed])),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("The comparison failed: select_model: class 'rare' has 3 train rows");
  });

  it("says the models are being cross-validated while the run is live", async () => {
    compared(winner);
    server.use(
      http.get("/api/runs", ({ request }) =>
        HttpResponse.json(new URL(request.url).searchParams.get("pipeline_version_id") === CPV ? [{ ...comparisonRun, status: "running" }] : [run]),
      ),
    );
    expect(await screen.findByText("Cross-validating 3 models…")).toBeInTheDocument();
  });

  it("says so when a finished run has no decision, instead of loading for ever", async () => {
    compared(winner);
    server.use(http.get(`/api/runs/${CRUN}/attempts`, () => HttpResponse.json([])));
    expect(await screen.findByRole("alert")).toHaveTextContent(`The comparison failed: run ${CRUN} has no select_model result`);
  });

  it("starts the model selection itself once the flow has run", async () => {
    const posted: string[] = [];
    compared(winner);
    server.use(
      http.get("/api/methodology_rules", () => HttpResponse.json([{ ...shortlistRule, applies_to: ["sprisk.ml.linear_model"] }])),
      http.post("/api/pipeline_versions/:id/model_selection/:node", ({ params }) => {
        posted.push(`${String(params.id)}/${String(params.node)}`);
        return HttpResponse.json({ proposal, comparison, run: comparisonRun }, { status: 201 });
      }),
    );
    await waitFor(() => expect(posted).toEqual([`${PV}/model`]));
  });

  it("asks for a run before Sprisk can choose the model", async () => {
    compared(winner);
    server.use(
      http.get("/api/methodology_rules", () => HttpResponse.json([{ ...shortlistRule, applies_to: ["sprisk.ml.linear_model"] }])),
      http.get("/api/runs", ({ request }) =>
        HttpResponse.json(new URL(request.url).searchParams.get("pipeline_version_id") === CPV ? [comparisonRun] : []),
      ),
    );
    expect(await screen.findByText("Run the flow, and Sprisk will compare models for model.")).toBeInTheDocument();
  });

  it("warns when the model was chosen after another branch had scored the test rows", async () => {
    const DECISION = "mdc_01JABCDEFGHJKMNPQRSTVWXYZ5";
    compared(winner);
    server.use(
      http.get("/api/pipeline_versions", () =>
        HttpResponse.json([comparison, { ...pipeline, nodes: pipeline.nodes.map((n) => (n.id === "model" ? { ...n, methodology_decision_id: DECISION } : n)) }]),
      ),
      http.get(`/api/methodology_decisions/${DECISION}`, () =>
        HttpResponse.json({ ...seenDecision, id: DECISION, pipeline_version_id: "plv_01JABCDEFGHJKMNPQRSTVWXYZ4" }),
      ),
    );
    expect(await screen.findByText(/This model was chosen after plv_01JABCDEFGHJKMNPQRSTVWXYZ1 had already scored the same test rows/)).toBeInTheDocument();
  });

  it("names repeated folds and each model's p against the baseline", async () => {
    compared(tested);
    const region = await screen.findByRole("region", { name: "Model comparison" });
    const table = await within(region).findByRole("table", { name: "Candidates" });
    expect(region).toHaveTextContent("10 × 5-fold cross-validation, seed 0");
    expect(row(table, "Gain over baseline")).toHaveTextContent("+0.398 ± 0.0145, p = 0.0001");
    expect(row(table, "Fold scores")).toHaveTextContent("5 scores, 0.87 to 0.93");
  });
});
