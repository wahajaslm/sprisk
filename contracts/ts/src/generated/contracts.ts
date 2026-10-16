/* Generated from contracts/schemas. Do not edit. */

/**
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "PipelineVersionId".
 */
export type PipelineVersionId = string;
/**
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "PortName".
 */
export type PortName = string;
/**
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "ArtifactId".
 */
export type ArtifactId = string;
/**
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "ProjectId".
 */
export type ProjectId = string;
/**
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "AttemptId".
 */
export type AttemptId = string;
/**
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "ContentHash".
 */
export type ContentHash = string;
/**
 * UTC, whole seconds, Z suffix. One canonical form so every language round-trips it unchanged. Pattern only: typify ignores pattern when format is set.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "Timestamp".
 */
export type Timestamp = string;
/**
 * Pinned operator: dotted name @ semver, e.g. sprisk.eval.binary_classification@1.0.0.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "OperatorRef".
 */
export type OperatorRef = string;
/**
 * explicit: user stated it. inferred: AI or rule guessed it. measured: computed from data. confirmed: user approved an inferred value.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "Origin".
 */
export type Origin = "explicit" | "inferred" | "measured" | "confirmed";
/**
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "SchemaId".
 */
export type SchemaId = string;
/**
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "InvestigationId".
 */
export type InvestigationId = string;
/**
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "QuestionVersionId".
 */
export type QuestionVersionId = string;
/**
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "RunId".
 */
export type RunId = string;
/**
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "WorkerId".
 */
export type WorkerId = string;
/**
 * Node name, unique within a pipeline version.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "NodeId".
 */
export type NodeId = string;
/**
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "MethodologyCheckId".
 */
export type MethodologyCheckId = string;
/**
 * Pinned rule: <pack>.<rule>@<semver>.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "CheckRef".
 */
export type CheckRef = string;
/**
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "Verdict".
 */
export type Verdict = "pass" | "fail" | "warning" | "not_assessed";
/**
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "CapabilityClass".
 */
export type CapabilityClass =
  | "source"
  | "transform"
  | "analyzer"
  | "estimator"
  | "evaluator"
  | "optimizer"
  | "decision_evaluator"
  | "sink"
  | "custom_code";
/**
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "PortKind".
 */
export type PortKind = "table" | "model" | "metrics" | "diagnostics" | "report" | "figure";
/**
 * pure: same inputs give same outputs, cacheable. nondeterministic: not replayable. side_effecting: changes the outside world; never auto-retried.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "Effects".
 */
export type Effects = "pure" | "nondeterministic" | "side_effecting";
/**
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "NetworkAccess".
 */
export type NetworkAccess = "none" | "egress_allowlisted";
/**
 * `<node_id>.<port_name>`.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "PortRef".
 */
export type PortRef = string;
/**
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "TaskType".
 */
export type TaskType = "exploration" | "classification" | "regression" | "undetermined";
/**
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "RunStatus".
 */
export type RunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";
/**
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "AttemptState".
 */
export type AttemptState =
  | "created"
  | "validated"
  | "queued"
  | "leased"
  | "running"
  | "uploading"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "timed_out"
  | "skipped"
  | "cache_hit";
/**
 * Local worker protocol message (arch doc §11). Tagged by `type`.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "WorkerMessage".
 */
export type WorkerMessage =
  Handshake | LeaseAttempt | Heartbeat | Progress | ArtifactManifest | Complete | Fail | Cancel | Acknowledge;

export interface Bundle {
  [k: string]: unknown;
}
/**
 * Request body for POST /runs: run a pipeline version that already passed Gate A.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "CreateRun".
 */
export interface CreateRun {
  pipeline_version_id: PipelineVersionId;
}
/**
 * One committed output of an attempt: the port that produced it and the artifact.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "AttemptOutput".
 */
export interface AttemptOutput {
  port: PortName;
  artifact: Artifact;
}
/**
 * Immutable, content-addressed output of a step attempt (arch doc §4, §10).
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "Artifact".
 */
export interface Artifact {
  schema_version: "sprisk.artifact/v1";
  id: ArtifactId;
  project_id: ProjectId;
  producer_attempt_id: AttemptId;
  content_hash: ContentHash;
  /**
   * IANA media type of the stored bytes.
   */
  media_type: string;
  /**
   * Declared data schema. Absent for artifacts without a tabular schema, such as model bundles.
   */
  schema_ref?: string;
  size_bytes: number;
  /**
   * Storage location. Opaque to domain logic; resolved by the artifact store.
   */
  uri: string;
  created_at: Timestamp;
}
/**
 * Error response body. Lists every problem found, not only the first.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "Problem".
 */
export interface Problem {
  errors: Error[];
}
/**
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "Error".
 */
export interface Error {
  code: string;
  message: string;
}
/**
 * One page of rows from a tabular artifact, for display (GET /artifacts/{id}/rows). Cells are display text, cut to a bounded length; a missing cell is listed by column index and its text is empty. Wide tables return only their first columns.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "TablePage".
 */
export interface TablePage {
  /**
   * Index of the first row in this page.
   */
  offset: number;
  total_rows: number;
  /**
   * Columns in the table; more than `columns` holds when the table is too wide to page whole.
   */
  total_columns: number;
  columns: TableColumn[];
  rows: TableRow[];
}
/**
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "TableColumn".
 */
export interface TableColumn {
  name: string;
  /**
   * Arrow data type name, for display only.
   */
  data_type: string;
}
/**
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "TableRow".
 */
export interface TableRow {
  values: string[];
  /**
   * Indexes of columns whose value is missing in this row.
   */
  missing: number[];
}
/**
 * Read-only source of a registered operator's entrypoint module, so every step's code can be read like a code step's. Served by GET /operators/{id}/source; the API reads only files inside the operator's plugin pack.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "OperatorSource".
 */
export interface OperatorSource {
  operator: OperatorRef;
  /**
   * Relative to the pack's src/, e.g. sprisk_clean/impute.py. Never an absolute path.
   */
  path: string;
  language: "python";
  text: string;
  /**
   * The operator's implementation digest: the code that runs, and the code shown, are the same.
   */
  digest: string;
}
/**
 * Figures a step drew (ADR-0024), converted by the worker: matplotlib as SVG text, Plotly as its figure JSON text.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "FigureSet".
 */
export interface FigureSet {
  items: Figure[];
}
/**
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "Figure".
 */
export interface Figure {
  library: "matplotlib" | "plotly";
  format: "svg" | "plotly_json";
  title?: string;
  /**
   * SVG markup, or a Plotly figure as JSON text.
   */
  content: string;
}
/**
 * What a code step showed (ADR-0020): printed text, tables and images, in order. Written by the worker as the step's display artifact; every part is capped.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "CodeDisplay".
 */
export interface CodeDisplay {
  items: DisplayItem[];
}
/**
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "DisplayItem".
 */
export interface DisplayItem {
  kind: "text" | "table" | "image";
  /**
   * Present for kind text.
   */
  text?: string;
  table?: TablePage1;
  /**
   * Present for kind image: a PNG, base64-encoded.
   */
  png_base64?: string;
  /**
   * For printed text: which stream it came from. Absent for displayed values. Warnings arrive on stderr.
   */
  channel?: "stdout" | "stderr";
}
/**
 * Present for kind table: the first rows only.
 */
export interface TablePage1 {
  /**
   * Index of the first row in this page.
   */
  offset: number;
  total_rows: number;
  /**
   * Columns in the table; more than `columns` holds when the table is too wide to page whole.
   */
  total_columns: number;
  columns: TableColumn[];
  rows: TableRow[];
}
/**
 * What a code step's run found about its interface (ADR-0021): names it reads, literal settings it could expose, and values it ends with. Suggestions, not a claim that arbitrary code is understood.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "CodeInterface".
 */
export interface CodeInterface {
  inputs: CodeInput[];
  parameters: CodeParameter[];
  outputs: CodeOutputCandidate[];
  /**
   * Files the code reads (ADR-0025): inputs, never parameters. Omitted in reports written before ADR-0025.
   */
  files?: CodeFileRead[];
}
/**
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "CodeInput".
 */
export interface CodeInput {
  name: string;
  origin: Origin;
  /**
   * True when the name is provided by the step (its input table or a library); false means the code reads a name nothing defines.
   */
  bound: boolean;
}
/**
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "CodeParameter".
 */
export interface CodeParameter {
  name: string;
  line: number;
  value_type: "integer" | "number" | "string" | "boolean";
  /**
   * The literal as written in the source.
   */
  default_text: string;
  /**
   * The literal the run used, as Python source.
   */
  effective_text: string;
  /**
   * explicit: user stated it. inferred: AI or rule guessed it. measured: computed from data. confirmed: user approved an inferred value.
   */
  origin: "explicit" | "inferred" | "measured" | "confirmed";
}
/**
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "CodeOutputCandidate".
 */
export interface CodeOutputCandidate {
  name: string;
  /**
   * Python type of the final value, e.g. polars.DataFrame.
   */
  type: string;
  rows?: number;
  columns?: number;
  origin: Origin;
  /**
   * This value became the step's data output.
   */
  chosen: boolean;
}
/**
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "CodeFileRead".
 */
export interface CodeFileRead {
  path: string;
  /**
   * The call that reads it, e.g. read_csv or open.
   */
  reader: string;
  line: number;
}
/**
 * Operator parameters. Validated against the operator's params_schema by the compiler, not here.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "Params".
 */
export interface Params {
  [k: string]: unknown;
}
/**
 * Result of one Gate B methodology rule on one pipeline version (arch doc §4, §8). Immutable; re-checking creates a new record.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "MethodologyCheck".
 */
export interface MethodologyCheck {
  schema_version: "sprisk.methodology_check/v1";
  id: MethodologyCheckId;
  pipeline_version_id: PipelineVersionId;
  check: CheckRef;
  verdict: Verdict;
  rationale: string;
  /**
   * Nodes the verdict is about. Empty when the rule found nothing to inspect.
   */
  cited_nodes: NodeId[];
  /**
   * What the rule could not assess. Omitted when there is nothing to say.
   */
  limitations?: string;
  created_at: Timestamp;
}
/**
 * Registered, versioned capability that a pipeline node runs (arch doc §5, §6).
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "Operator".
 */
export interface Operator {
  schema_version: "sprisk.operator/v1";
  id: OperatorRef;
  capability_class: CapabilityClass;
  description?: string;
  /**
   * Python `module:function` the worker calls.
   */
  entrypoint: string;
  inputs: Port[];
  outputs: Port[];
  /**
   * JSON Schema for this operator's params. The compiler validates node params against it.
   */
  params_schema: {
    [k: string]: unknown;
  };
  effects: Effects;
  network: NetworkAccess;
  resources: Resources;
}
/**
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "Port".
 */
export interface Port {
  name: PortName;
  kind: PortKind;
  description?: string;
}
/**
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "Resources".
 */
export interface Resources {
  cpu_cores: number;
  memory_mb: number;
  gpu: "none" | "optional" | "required";
  timeout_seconds: number;
}
/**
 * Immutable typed graph of pinned operators (arch doc §4, §5). Structural checks (at least one node, unique node ids, known ports, no cycles) belong to the Rust compiler, not this schema.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "PipelineVersion".
 */
export interface PipelineVersion {
  schema_version: "sprisk.pipeline_version/v1";
  id: PipelineVersionId;
  project_id: ProjectId;
  /**
   * Version this one was derived from. Absent for the first version.
   */
  parent_id?: string;
  nodes: Node[];
  edges: Edge[];
  created_at: Timestamp;
}
/**
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "Node".
 */
export interface Node {
  id: NodeId;
  operator: OperatorRef;
  params: Params;
}
/**
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "Edge".
 */
export interface Edge {
  from: PortRef;
  to: PortRef;
}
/**
 * Immutable formal statement of what an investigation asks (arch doc §4, §7). Every field records its origin. An absent target means no supervised target exists; never invent one.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "QuestionVersion".
 */
export interface QuestionVersion {
  schema_version: "sprisk.question_version/v1";
  id: QuestionVersionId;
  investigation_id: InvestigationId;
  /**
   * Version this one revises. Absent for the first version.
   */
  parent_id?: string;
  objective: Fact;
  task: TaskFact;
  target?: Fact1;
  unit_of_analysis?: Fact;
  time_column?: Fact;
  assumptions: Fact[];
  unknowns: Unknown[];
  acceptance_criteria: Fact[];
  created_at: Timestamp;
}
/**
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "Fact".
 */
export interface Fact {
  value: string;
  origin: Origin;
}
/**
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "TaskFact".
 */
export interface TaskFact {
  value: TaskType;
  origin: Origin;
}
/**
 * Target column. Absent when there is no legitimate supervised target.
 */
export interface Fact1 {
  value: string;
  origin: Origin;
}
/**
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "Unknown".
 */
export interface Unknown {
  question: string;
  /**
   * Earliest stage this unknown must be resolved before.
   */
  blocks: "planning" | "execution" | "release";
}
/**
 * One execution of a pipeline version against its inputs (arch doc §4, §9). Status is the transactionally maintained current state; history lives in attempts and audit events.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "Run".
 */
export interface Run {
  schema_version: "sprisk.run/v1";
  id: RunId;
  project_id: ProjectId;
  pipeline_version_id: PipelineVersionId;
  status: RunStatus;
  created_at: Timestamp;
  /**
   * UTC, whole seconds, Z suffix. One canonical form so every language round-trips it unchanged. Pattern only: typify ignores pattern when format is set.
   */
  finished_at?: string;
}
/**
 * One try of one step (a node in a run). Retries create a new attempt with the next number; old attempts are never replaced (arch doc §9).
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "Attempt".
 */
export interface Attempt {
  schema_version: "sprisk.attempt/v1";
  id: AttemptId;
  run_id: RunId;
  node_id: NodeId;
  /**
   * 1 for the first try of this step.
   */
  number: number;
  state: AttemptState;
  /**
   * Set once leased.
   */
  worker_id?: string;
  /**
   * UTC, whole seconds, Z suffix. One canonical form so every language round-trips it unchanged. Pattern only: typify ignores pattern when format is set.
   */
  lease_expires_at?: string;
  error?: Error1;
  created_at: Timestamp;
}
/**
 * Set when state is failed or timed_out.
 */
export interface Error1 {
  code: string;
  message: string;
}
/**
 * Worker → control plane, first message. Declares protocol version and operators the worker can run.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "Handshake".
 */
export interface Handshake {
  type: "handshake";
  protocol_version: "sprisk.worker/v1";
  worker_id: WorkerId;
  operators: OperatorRef[];
}
/**
 * Control plane → worker. Grants one attempt until lease_expires_at. Inputs are artifact references, never data.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "LeaseAttempt".
 */
export interface LeaseAttempt {
  type: "lease_attempt";
  attempt_id: AttemptId;
  run_id: RunId;
  node_id: NodeId;
  operator: OperatorRef;
  params: Params;
  inputs: InputBinding[];
  /**
   * Only location the worker may write outputs to. Scoped to this attempt.
   */
  staging_uri: string;
  lease_expires_at: Timestamp;
}
/**
 * Committed input artifact, resolved by the control plane. Read-only. The worker verifies content_hash before use.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "InputBinding".
 */
export interface InputBinding {
  port: PortName;
  artifact_id: ArtifactId;
  uri: string;
  content_hash: ContentHash;
}
/**
 * Worker → control plane. Extends the lease.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "Heartbeat".
 */
export interface Heartbeat {
  type: "heartbeat";
  attempt_id: AttemptId;
}
/**
 * Worker → control plane. Informational only; never authoritative.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "Progress".
 */
export interface Progress {
  type: "progress";
  attempt_id: AttemptId;
  completed: number;
  total: number;
}
/**
 * Worker → control plane. One output written to staging. The control plane verifies and commits it.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "ArtifactManifest".
 */
export interface ArtifactManifest {
  type: "artifact_manifest";
  attempt_id: AttemptId;
  port: PortName;
  staging_uri: string;
  content_hash: ContentHash;
  media_type: string;
  schema_ref?: SchemaId;
  size_bytes: number;
}
/**
 * Worker → control plane. All manifests sent; attempt finished.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "Complete".
 */
export interface Complete {
  type: "complete";
  attempt_id: AttemptId;
}
/**
 * Worker → control plane. Attempt failed. failure_kind guides retry policy; side-effecting operators are never auto-retried.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "Fail".
 */
export interface Fail {
  type: "fail";
  attempt_id: AttemptId;
  error: Error;
  failure_kind: "transient" | "permanent";
}
/**
 * Control plane → worker. Stop the attempt.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "Cancel".
 */
export interface Cancel {
  type: "cancel";
  attempt_id: AttemptId;
}
/**
 * Control plane → worker. Last message for this attempt was committed.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "Acknowledge".
 */
export interface Acknowledge {
  type: "acknowledge";
  attempt_id: AttemptId;
}
