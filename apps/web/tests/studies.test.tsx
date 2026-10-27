import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import appliedDecision from "../../../tests/contract/applied_methodology_decision/valid/applied.json";
import tuned from "../../../tests/contract/selection_decision/valid/tuned-with-guardrail.json";
import { Experiments } from "../src/views/Experiments.tsx";
import { useSelection } from "../src/workbench/selection.ts";
import { PV, RUN, pipeline, run, scoreAttempt, scoreOutputs } from "./fixtures.ts";
import { renderWithApi } from "./render.tsx";
import { comparedModel, server } from "./server.ts";

const MPR = "mpr_01JABCDEFGHJKMNPQRSTVWXYZ0";
const CPV = "plv_01JABCDEFGHJKMNPQRSTVWXYZ8";
const CRUN = "run_01JABCDEFGHJKMNPQRSTVWXYZ8";
const STD = "std_01JABCDEFGHJKMNPQRSTVWXYZ0";
const CANDIDATE = { target: "y", features: ["x"], task: "classification" };

const trialNode = (id: string, model: string, settings: object = {}) => ({
  id: `cv_${id}`,
  operator: "sprisk.ml.cross_validate@3.0.0",
  params: { candidate: model, candidate_params: { ...CANDIDATE, ...settings }, prepare: [] },
});
const comparison = {
  ...pipeline,
  id: CPV,
  compares: MPR,
  nodes: [
    ...pipeline.nodes.filter((n) => n.id === "load" || n.id === "split"),
    trialNode("ml_dummy_baseline", "sprisk.ml.dummy_baseline@1.0.0"),
    trialNode("ml_linear_model", "sprisk.ml.linear_model@1.0.0"),
    trialNode("ml_random_forest_t1", "sprisk.ml.random_forest@1.1.0", { min_samples_leaf: 1 }),
    trialNode("ml_random_forest_t2", "sprisk.ml.random_forest@1.1.0", { min_samples_leaf: 5 }),
    { id: "select_model", operator: "sprisk.ml.select_model@4.0.0", params: {} },
  ],
};
const proposal = {
  schema_version: "sprisk.decision_proposal/v1",
  id: MPR,
  rule: "methodology.supervised.model_baseline_selection@2.0.0",
  question_version_id: "qv_01JABCDEFGHJKMNPQRSTVWXYZ0",
  pipeline_version_id: PV,
  subject_node_id: "model",
  evidence: [],
  alternatives: ["dummy_baseline", "linear_model", "random_forest"].map((name) => ({
    id: `ml_${name}`,
    label: `sprisk.ml.${name}@1.0.0`,
    description: name,
    applicability: "applicable",
    reason: `Why ${name}.`,
  })),
  shortlist: ["ml_dummy_baseline", "ml_linear_model", "ml_random_forest"],
  fingerprint: `sha256:${"0".repeat(64)}`,
  created_at: "2026-10-19T10:00:00Z",
};
const comparisonRun = { ...run, id: CRUN, pipeline_version_id: CPV };
const study = {
  schema_version: "sprisk.study/v1",
  id: STD,
  project_id: pipeline.project_id,
  pipeline_version_id: PV,
  node_id: "model",
  proposal_id: MPR,
  comparison_id: CPV,
  run_id: CRUN,
  strategy: "random",
  seed: 7,
  max_trials: 4,
  max_wall_seconds: 600,
  guardrails: [{ metric: "recall", label: "bad", at_least: 0.6 }],
  status: "running",
  deadline: "2026-10-21T10:10:01Z",
  created_at: "2026-10-21T10:00:00Z",
};
const trial = (node: string, candidate: string, operator: string, settings: object, state: string) => ({
  schema_version: "sprisk.trial/v1",
  study_id: STD,
  node_id: `cv_${node}`,
  candidate,
  operator,
  settings,
  state,
  attempts: state === "not_started" ? [] : ["att_01JABCDEFGHJKMNPQRSTVWXY81"],
});
const trials = (forestState: string) => [
  trial("ml_dummy_baseline", "ml_dummy_baseline", "sprisk.ml.dummy_baseline@1.0.0", {}, "succeeded"),
  trial("ml_linear_model", "ml_linear_model", "sprisk.ml.linear_model@1.0.0", {}, "succeeded"),
  trial("ml_random_forest_t1", "ml_random_forest", "sprisk.ml.random_forest@1.1.0", { min_samples_leaf: 1 }, "succeeded"),
  trial("ml_random_forest_t2", "ml_random_forest", "sprisk.ml.random_forest@1.1.0", { min_samples_leaf: 5 }, forestState),
];
const selectAttempt = { ...scoreAttempt, id: "att_01JABCDEFGHJKMNPQRSTVWXY80", run_id: CRUN, node_id: "select_model" };
const decisionOutput = {
  port: "decision",
  artifact: { ...scoreOutputs[0]!.artifact, id: "art_01JABCDEFGHJKMNPQRSTVWXY80", producer_attempt_id: selectAttempt.id },
};

function studied(status: string, runStatus: string, forestState: string, decision: object = tuned) {
  const applied: unknown[] = [];
  const created: unknown[] = [];
  const shown = { ...study, status, ...(status === "running" ? {} : { finished_at: "2026-10-21T10:05:00Z" }) };
  server.use(
    http.get("/api/pipeline_versions", () => HttpResponse.json([comparison, pipeline])),
    http.get(`/api/methodology_proposals/${MPR}`, () => HttpResponse.json(proposal)),
    http.get(`/api/pipeline_versions/${PV}/studies`, () => HttpResponse.json([shown])),
    http.get(`/api/studies/${STD}`, () =>
      HttpResponse.json({ study: shown, trials: trials(forestState), run: { ...comparisonRun, status: runStatus } }),
    ),
    http.get("/api/runs", ({ request }) =>
      HttpResponse.json(
        new URL(request.url).searchParams.get("pipeline_version_id") === CPV ? [{ ...comparisonRun, status: runStatus }] : [run],
      ),
    ),
    http.get(`/api/runs/${CRUN}/attempts`, () => HttpResponse.json([selectAttempt])),
    http.get(`/api/attempts/${selectAttempt.id}/outputs`, () => HttpResponse.json([decisionOutput])),
    http.get(`/api/artifacts/${decisionOutput.artifact.id}/content`, () => HttpResponse.text(JSON.stringify(decision))),
    ...comparedModel,
    http.post("/api/pipeline_versions/:id/model_selection/:node", () =>
      HttpResponse.json({ errors: [{ code: "nothing_to_compare", message: "not in this test" }] }, { status: 422 }),
    ),
    http.post(`/api/methodology_proposals/${MPR}/apply`, async ({ request }) => {
      applied.push(await request.json());
      return HttpResponse.json(appliedDecision, { status: 201 });
    }),
    http.post(`/api/pipeline_versions/${PV}/studies/model`, async ({ request }) => {
      created.push(await request.json());
      return HttpResponse.json(
        { errors: [{ code: "over_budget", message: "this study has 11 trials; its budget allows 4" }] },
        { status: 422 },
      );
    }),
  );
  useSelection.setState({ pipelineVersionId: PV, runId: RUN, experimentsTab: "Sweep" });
  renderWithApi(<Experiments />);
  return { applied, created };
}

// The first test of the file also loads the page's modules, so it may take past the 1 s default.
const studyRegion = () => screen.findByRole("region", { name: "Experiment of model" }, { timeout: 3000 });

describe("studies", () => {
  it("shows a running study's budget, what it searched and its trials side by side", async () => {
    studied("running", "running", "running");
    const region = await studyRegion();
    expect(region).toHaveTextContent("random search, seed 7");
    await waitFor(() => expect(region).toHaveTextContent("3 of 4 trials finished"));
    expect(region).toHaveTextContent("budget 4 trials, wall time 600 s, until 2026-10-21T10:10:01Z");
    expect(region).toHaveTextContent("Guardrail: recall of bad at least 0.6, declared before this experiment's scores");
    expect(within(region).getByLabelText("Search space")).toHaveTextContent("min_samples_leaf1 – 5");
    const table = within(region).getByRole("table", { name: "Trials" });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(4);
    expect(rows[2]).toHaveTextContent("ml_random_forestmin_samples_leaf: 1succeeded—");
    expect(rows[3]).toHaveTextContent("ml_random_forestmin_samples_leaf: 5running—");
    expect(rows[1]).toHaveTextContent("ml_linear_modelthe pipeline's settingssucceeded—");
  });

  it("ranks the trials by their mean fold score and draws them as parallel coordinates", async () => {
    studied("running", "running", "succeeded");
    const scored = (id: string, values: number[]) =>
      HttpResponse.json({ offset: 0, total_rows: values.length, total_columns: 3, columns: [{ name: "metric", data_type: "String" }, { name: "fold", data_type: "Int64" }, { name: "score", data_type: "Float64" }], rows: values.map((v, i) => ({ values: ["accuracy", String(i + 1), String(v)], missing: [] })) });
    const withScores = trials("succeeded").map((t, i) => ({ ...t, scores: `art_01JABCDEFGHJKMNPQRSTVWXY9${i}` }));
    server.use(
      http.get(`/api/studies/${STD}`, () => HttpResponse.json({ study, trials: withScores, run: { ...comparisonRun, status: "running" } })),
      http.get("/api/artifacts/:id/rows", ({ params }) => scored(String(params.id), String(params.id).endsWith("93") ? [0.9, 0.8] : String(params.id).endsWith("92") ? [0.7, 0.7] : [0.5, 0.5])),
    );
    const region = await studyRegion();
    const table = within(region).getByRole("table", { name: "Trials" });
    await waitFor(() => expect(within(table).getAllByRole("row")[1]).toHaveTextContent("min_samples_leaf: 5succeeded0.85"));
    expect(within(region).getByRole("img", { name: "Trials of model" })).toBeInTheDocument();
  });

  it("says a study that ran out of time decided nothing and kept its finished trials", async () => {
    studied("budget_reached", "cancelled", "not_started");
    const region = await studyRegion();
    expect(await within(region).findByText(/The wall-time budget ran out/)).toHaveTextContent(
      "3 finished trials are kept and nothing was decided",
    );
    expect(within(region).queryByRole("table", { name: "Candidates" })).not.toBeInTheDocument();
  });

  it("shows a decided study's chosen settings, guardrails and earlier looks, once", async () => {
    studied("completed", "succeeded", "succeeded", { ...tuned, earlier_looks: ["plv_01JABCDEFGHJKMNPQRSTVWXYZ3"] });
    const region = await studyRegion();
    const table = await within(region).findByRole("table", { name: "Candidates" });
    const row = (label: string) => within(table).getByRole("row", { name: new RegExp(`^${label}`) });
    expect(row("Settings")).toHaveTextContent("the pipeline'sthe pipeline'smin_samples_leaf: 5");
    expect(row("Recall of bad")).toHaveTextContent("0.55 ± 0.04 misses0.55 ± 0.04 misses0.66 ± 0.04 meets it");
    expect(region).toHaveTextContent("comparison was started 1 time before on the same folds");
    // The study's comparison is shown in the study, not again as a model comparison.
    expect(screen.queryByRole("region", { name: "Model comparison" })).not.toBeInTheDocument();
  });

  it("lists what a tuned model's search saw in its detail", async () => {
    studied("completed", "succeeded", "succeeded");
    const region = await studyRegion();
    // The recommendation and the best other model open in detail by themselves.
    const detail = await within(region).findByRole("region", { name: "Detail of ml_random_forest" });
    const search = within(detail).getByRole("table", { name: "Search of ml_random_forest" });
    const rows = within(search).getAllByRole("row").slice(1);
    expect(rows[0]).toHaveTextContent("min_samples_leaf: 10.713 of 50 folds");
    expect(rows[1]).toHaveTextContent("min_samples_leaf: 50.7447 of 50 folds · applied");
    expect(detail).toHaveTextContent("not a performance estimate");
    expect(detail).toHaveTextContent("No figure: the applied setting was chosen using these train rows");
  });

  it("uses a study's recommendation with no reason", async () => {
    const { applied } = studied("completed", "succeeded", "succeeded");
    const region = await studyRegion();
    await userEvent.click(await within(region).findByRole("button", { name: "Use ml_linear_model" }));
    await userEvent.click(within(region).getByRole("button", { name: "Apply ml_linear_model to a new version" }));
    await waitFor(() => expect(applied).toHaveLength(1));
    expect(applied[0]).not.toHaveProperty("reason");
  });

  it("starts a study with the budget and guardrail asked for, and shows why one is refused", async () => {
    const { created } = studied("completed", "succeeded", "succeeded");
    await userEvent.click(await screen.findByRole("button", { name: "Experiment model" }));
    const form = screen.getByRole("form", { name: "New experiment of model" });
    await userEvent.click(within(form).getByRole("radio", { name: "Random" }));
    await userEvent.clear(within(form).getByLabelText("Seed"));
    await userEvent.type(within(form).getByLabelText("Seed"), "3");
    await userEvent.clear(within(form).getByLabelText("Most trials"));
    await userEvent.type(within(form).getByLabelText("Most trials"), "4");
    await userEvent.clear(within(form).getByLabelText("Most seconds"));
    await userEvent.type(within(form).getByLabelText("Most seconds"), "300");
    await userEvent.type(within(form).getByLabelText("Minimum recall of class"), "bad");
    await userEvent.type(within(form).getByLabelText("At least"), "0.6");
    await userEvent.click(within(form).getByRole("button", { name: "Start the experiment" }));
    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0]).toMatchObject({
      strategy: "random",
      seed: 3,
      max_trials: 4,
      max_wall_seconds: 300,
      guardrails: [{ metric: "recall", label: "bad", at_least: 0.6 }],
    });
    expect(await within(form).findByRole("alert")).toHaveTextContent("this study has 11 trials; its budget allows 4");
  });
});

describe("study states and the form", () => {
  it("says a study failed", async () => {
    studied("failed", "failed", "failed");
    const region = await studyRegion();
    expect(await within(region).findByRole("alert")).toHaveTextContent("The experiment failed: a step failed after its retries.");
  });

  it("says when no shortlisted model declares settings to search", async () => {
    studied("running", "running", "running");
    server.use(
      http.get(`/api/studies/${STD}`, () =>
        HttpResponse.json({ study, trials: trials("running").slice(0, 2), run: { ...comparisonRun, status: "running" } }),
      ),
    );
    const region = await studyRegion();
    expect(await within(region).findByText(/Searched: nothing; no shortlisted model declares settings to tune/)).toBeInTheDocument();
  });

  it("sends nothing while a budget field is empty or a guardrail is half filled", async () => {
    const { created } = studied("completed", "succeeded", "succeeded");
    await userEvent.click(await screen.findByRole("button", { name: "Experiment model" }));
    const form = screen.getByRole("form", { name: "New experiment of model" });
    const start = within(form).getByRole("button", { name: "Start the experiment" });
    await userEvent.type(within(form).getByLabelText("At least"), "0.6");
    expect(start).toBeDisabled();
    await userEvent.clear(within(form).getByLabelText("At least"));
    await userEvent.clear(within(form).getByLabelText("Seed"));
    await userEvent.click(start);
    expect(created).toHaveLength(0);
  });

  it("shows why the experiments cannot be listed", async () => {
    studied("running", "running", "running");
    server.use(
      http.get(`/api/pipeline_versions/${PV}/studies`, () =>
        HttpResponse.json({ errors: [{ code: "internal", message: "store down" }] }, { status: 500 }),
      ),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("The pipeline's experiments cannot be shown: internal: store down");
  });
});

describe("several studies of one step", () => {
  it("says the step has several studies and which settings make them not directly comparable", async () => {
    studied("completed", "succeeded", "succeeded");
    const other = { ...study, id: "std_01JABCDEFGHJKMNPQRSTVWXYZ1", seed: 8, status: "completed" };
    server.use(
      http.get(`/api/pipeline_versions/${PV}/studies`, () => HttpResponse.json([{ ...study, status: "completed" }, other])),
      http.get(`/api/studies/${other.id}`, () =>
        HttpResponse.json({ study: other, trials: trials("succeeded"), run: comparisonRun }),
      ),
    );
    const cards = await screen.findAllByRole("region", { name: "Experiment of model" });
    expect(cards).toHaveLength(2);
    for (const card of cards) {
      await waitFor(() => expect(card).toHaveTextContent("model has 2 studies on the same folds"));
      expect(card).toHaveTextContent("Not directly comparable with the others: they differ in seed.");
    }
  });
});
