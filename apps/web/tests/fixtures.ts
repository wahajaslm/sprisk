import { parse } from "@sprisk/contracts";
import { vi } from "vitest";

import type { DockCommands } from "../src/workbench/workbench.ts";
import type { ColumnRole, TablePage } from "@sprisk/contracts";
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

/** A dock that records commands; the real one needs a browser layout engine. */
export function fakeDock(overrides: Partial<DockCommands> = {}): DockCommands {
  return { openTab: vi.fn(), showTab: vi.fn(), resetLayout: vi.fn(), ...overrides };
}

export const operators: Operator[] = [
  {
    ...op("sprisk.io.file_source@1.0.0", "source", [], [["data", "table"]]),
    params_schema: {
      type: "object",
      properties: { path: { type: "string", "x-sprisk-local-path": true }, format: { type: "string", enum: ["csv", "parquet"] } },
    },
  },
  op("sprisk.profile.summarize@1.0.0", "analyzer", [["data", "table"]], [["profile", "diagnostics"]]),
  op("sprisk.validation.random_split@1.0.0", "transform", [["data", "table"]], [["train", "table"], ["test", "table"]]),
  { ...op("sprisk.clean.impute@1.0.0", "transform", [["train", "table"], ["test", "table"]], [["train", "table"], ["test", "table"]]), fits_on_train: true, title: "Imputation" },
  op("sprisk.ml.linear_model@1.0.0", "estimator", [["train", "table"]], [["model", "model"]]),
  op("sprisk.ml.evaluate@1.0.0", "evaluator", [["model", "model"], ["test", "table"]], [["metrics", "metrics"]]),
  {
    ...op("sprisk.profile.chart@1.0.0", "analyzer", [["data", "table"]], [["chart", "figure"]]),
    params_schema: {
      type: "object",
      required: ["kind", "x"],
      properties: {
        kind: { type: "string", enum: ["histogram", "box", "scatter"], "x-sprisk-show-in": "visualizations" },
        x: { type: "string", "x-sprisk-column": true, "x-sprisk-show-in": "visualizations" },
        y: { type: "string", "x-sprisk-column": true, "x-sprisk-show-in": "visualizations" },
        bins: { type: "integer", default: 20 },
      },
    },
  },
];

/** The notebook-cell code step: its ports are variable names in its params (ADR-0031). */
export const notebookOperator: Operator = {
  ...op("sprisk.code.python@2.0.0", "analyzer", [], [["display", "diagnostics"], ["interface", "diagnostics"]]),
  params_schema: {
    type: "object",
    properties: {
      source: { type: "string" },
      inputs: { type: "array", items: { type: "string" }, "x-sprisk-ports": "input" },
      outputs: { type: "array", items: { type: "string" }, "x-sprisk-ports": "output" },
    },
  },
};

export const PV = "plv_01JABCDEFGHJKMNPQRSTVWXYZ0";
export const RUN = "run_01JABCDEFGHJKMNPQRSTVWXYZ0";
const NOW = "2026-10-16T10:00:00Z";

export const pipeline: PipelineVersion = {
  schema_version: "sprisk.pipeline_version/v1",
  id: PV,
  project_id: "prj_00000000000000000000000000",
  nodes: [
    { id: "load", operator: "sprisk.io.file_source@1.0.0", params: { path: "/d/iris.csv", format: "csv" } },
    { id: "profile", operator: "sprisk.profile.summarize@1.0.0", params: {} },
    { id: "split", operator: "sprisk.validation.random_split@1.0.0", params: { test_fraction: 0.25, seed: 42 } },
    { id: "impute", operator: "sprisk.clean.impute@1.0.0", params: { columns: ["x"], method: "median" } },
    { id: "model", operator: "sprisk.ml.linear_model@1.0.0", params: { target: "y", features: ["x"], task: "classification" } },
    { id: "score", operator: "sprisk.ml.evaluate@1.0.0", params: { target: "y", task: "classification" } },
  ],
  edges: [
    { from: "load.data", to: "split.data" },
    { from: "load.data", to: "profile.data" },
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
  attempt("profile", "succeeded"),
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

export const loadAttempt = attempts[1]!;

export const loadOutputs: AttemptOutput[] = [
  {
    port: "data",
    artifact: {
      ...scoreOutputs[0]!.artifact,
      id: "art_01JABCDEFGHJKMNPQRSTVWXYZ2",
      producer_attempt_id: loadAttempt.id,
      media_type: "application/vnd.apache.parquet",
      size_bytes: 4_000_000,
    },
  },
];

/** 120 rows; sepal_length is missing on row 3. */
export function tablePage(offset: number, limit: number): TablePage {
  const end = Math.min(offset + limit, 120);
  const rows = [];
  for (let i = offset; i < end; i++) {
    rows.push(i === 3 ? { values: ["", "setosa"], missing: [0] } : { values: [`${i}.5`, "setosa"], missing: [] });
  }
  return {
    offset,
    total_rows: 120,
    total_columns: 2,
    columns: [
      { name: "sepal_length", data_type: "Float64" },
      { name: "species", data_type: "Utf8View" },
    ],
    rows,
  };
}

export const profileAttempt = attempts[7]!;

export const profileOutputs: AttemptOutput[] = [
  {
    port: "profile",
    artifact: { ...loadOutputs[0]!.artifact, id: "art_01JABCDEFGHJKMNPQRSTVWXYZ3", producer_attempt_id: profileAttempt.id },
  },
];

const SUMMARY_COLUMNS = ["column_name", "column_type", "min", "max", "approx_unique", "avg", "std", "q25", "q50", "q75", "count", "null_percentage"];

/** DuckDB SUMMARIZE output, as the profile step writes it. */
export const profilePage: TablePage = {
  offset: 0,
  total_rows: 2,
  total_columns: SUMMARY_COLUMNS.length,
  columns: SUMMARY_COLUMNS.map((name) => ({ name, data_type: "Utf8View" })),
  rows: [
    { values: ["sepal_length", "DOUBLE", "4.3", "7.9", "35", "5.843", "0.828", "5.1", "5.8", "6.4", "150", "2.67"], missing: [] },
    { values: ["species", "VARCHAR", "setosa", "virginica", "3", "", "", "", "", "", "150", "0.00"], missing: [5, 6, 7, 8, 9] },
  ],
};

/** The fixture flow plus one code step reading load.data. */
export const codePipeline: PipelineVersion = {
  ...pipeline,
  nodes: [...pipeline.nodes, { id: "code_1", operator: "sprisk.code.python@1.0.0", params: { source: "print(data.height)\ndata.head(1)" } }],
  edges: [...pipeline.edges, { from: "load.data", to: "code_1.data" }],
};

export const codeAttempt: Attempt = { ...attempts[1]!, id: "att_01JABCDEFGHJKMNPQRSTVWXY99", node_id: "code_1" };

export const codeOutputs: AttemptOutput[] = [
  {
    port: "display",
    artifact: { ...scoreOutputs[0]!.artifact, id: "art_01JABCDEFGHJKMNPQRSTVWXYZ4", producer_attempt_id: codeAttempt.id, size_bytes: 900 },
  },
];

export const codeDisplayJson = JSON.stringify({
  items: [
    { kind: "text", text: "150\n" },
    { kind: "table", table: { ...tablePage(0, 1), total_rows: 150 } },
    { kind: "image", png_base64: "iVBORw0KGgo=" },
  ],
});

export const column = (name: string, data_type: string, distinct: number, role?: ColumnRole) => ({
  name,
  data_type,
  missing: 0,
  distinct,
  missing_by_band: [0],
  ...(role ? { role } : {}),
});

/** A Rakuten-like table: an id, two free-text columns and a 27-class code. */
export const rakuten = parse("DatasetProfile", {
  total_rows: 84916,
  total_columns: 4,
  profiled_rows: 84916,
  band_rows: 1000,
  columns: [
    column("id", "Int64", 84916, "identifier"),
    column("designation", "String", 82265, "text"),
    column("description", "String", 47508, "text"),
    column("prdtypecode", "Int64", 27, "category"),
  ],
  correlation: { columns: [], pairs: [] },
});
