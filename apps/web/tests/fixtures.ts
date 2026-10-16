import type { Attempt, AttemptOutput, Operator, PipelineVersion, Run } from "@sprisk/contracts";

const resources = { cpu_cores: 1, memory_mb: 512, gpu: "none", timeout_seconds: 60 } as const;

function op(id: string, capability_class: Operator["capability_class"], inputs: [string, string][], outputs: [string, string][]): Operator {
  const ports = (ps: [string, string][]) => ps.map(([name, kind]) => ({ name, kind })) as Operator["inputs"];
  return {
    schema_version: "sprisk.operator/v1",
    id,
    capability_class,
    entrypoint: "m:f",
    inputs: ports(inputs),
    outputs: ports(outputs),
    params_schema: { type: "object" },
    effects: "pure",
    network: "none",
    resources,
  };
}

export const operators: Operator[] = [
  op("sprisk.io.file_source@1.0.0", "source", [], [["data", "table"]]),
  op("sprisk.validation.random_split@1.0.0", "transform", [["data", "table"]], [["train", "table"], ["test", "table"]]),
  op("sprisk.clean.impute@1.0.0", "transform", [["train", "table"], ["test", "table"]], [["train", "table"], ["test", "table"]]),
  op("sprisk.ml.linear_model@1.0.0", "estimator", [["train", "table"]], [["model", "model"]]),
  op("sprisk.ml.evaluate@1.0.0", "evaluator", [["model", "model"], ["test", "table"]], [["metrics", "metrics"]]),
];

export const PV = "plv_01JABCDEFGHJKMNPQRSTVWXYZ0";
export const RUN = "run_01JABCDEFGHJKMNPQRSTVWXYZ0";
const NOW = "2026-10-16T10:00:00Z";

export const pipeline: PipelineVersion = {
  schema_version: "sprisk.pipeline_version/v1",
  id: PV,
  project_id: "prj_00000000000000000000000000",
  nodes: [
    { id: "load", operator: "sprisk.io.file_source@1.0.0", params: { path: "/d/iris.csv", format: "csv" } },
    { id: "split", operator: "sprisk.validation.random_split@1.0.0", params: { test_fraction: 0.25, seed: 42 } },
    { id: "impute", operator: "sprisk.clean.impute@1.0.0", params: { columns: ["x"], method: "median" } },
    { id: "model", operator: "sprisk.ml.linear_model@1.0.0", params: { target: "y", features: ["x"], task: "classification" } },
    { id: "score", operator: "sprisk.ml.evaluate@1.0.0", params: { target: "y", task: "classification" } },
  ],
  edges: [
    { from: "load.data", to: "split.data" },
    { from: "split.train", to: "impute.train" },
    { from: "split.test", to: "impute.test" },
    { from: "impute.train", to: "model.train" },
    { from: "model.model", to: "score.model" },
    { from: "impute.test", to: "score.test" },
  ],
  created_at: NOW,
};

export const run: Run = {
  schema_version: "sprisk.run/v1",
  id: RUN,
  project_id: "prj_00000000000000000000000000",
  pipeline_version_id: PV,
  status: "succeeded",
  created_at: NOW,
  finished_at: NOW,
};

let n = 0;
function attempt(node_id: string, state: Attempt["state"], number = 1, error?: Attempt["error"]): Attempt {
  n += 1;
  return {
    schema_version: "sprisk.attempt/v1",
    id: `att_01JABCDEFGHJKMNPQRSTVWXY${String(n).padStart(2, "0")}`,
    run_id: RUN,
    node_id,
    number,
    state,
    created_at: NOW,
    ...(error ? { error } : {}),
  };
}

export const attempts: Attempt[] = [
  attempt("gate_b", "succeeded"),
  attempt("load", "succeeded"),
  attempt("split", "failed", 1, { code: "worker_lost", message: "worker exited" }),
  attempt("split", "succeeded", 2),
  attempt("impute", "succeeded"),
  attempt("model", "succeeded"),
  attempt("score", "succeeded"),
];

export const scoreAttempt = attempts[6]!;

export const scoreOutputs: AttemptOutput[] = [
  {
    port: "metrics",
    artifact: {
      schema_version: "sprisk.artifact/v1",
      id: "art_01JABCDEFGHJKMNPQRSTVWXYZ0",
      project_id: "prj_00000000000000000000000000",
      producer_attempt_id: scoreAttempt.id,
      content_hash: `sha256:${"a".repeat(64)}`,
      media_type: "application/json",
      size_bytes: 80,
      uri: "file:///store/aa",
      created_at: NOW,
    },
  },
];

export const metricsJson = '{"n_rows": 38, "estimator": "LogisticRegression", "accuracy": 0.947}';

export const gateAttempt = attempts[0]!;

export const gateOutputs: AttemptOutput[] = [
  {
    port: "checks",
    artifact: { ...scoreOutputs[0]!.artifact, id: "art_01JABCDEFGHJKMNPQRSTVWXYZ1", producer_attempt_id: gateAttempt.id },
  },
];

export const checksJson = JSON.stringify([
  {
    schema_version: "sprisk.methodology_check/v1",
    id: "mck_01JABCDEFGHJKMNPQRSTVWXYZ0",
    pipeline_version_id: PV,
    check: "supervised.split_leakage@1.0.0",
    verdict: "pass",
    rationale: "Each holdout scores at most one non-baseline model.",
    cited_nodes: ["score", "split"],
    created_at: NOW,
  },
]);
