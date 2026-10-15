/* Generated from contracts/schemas. Do not edit. */

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
 * via the `definition` "PipelineVersionId".
 */
export type PipelineVersionId = string;
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
 * via the `definition` "PortName".
 */
export type PortName = string;
/**
 * Pinned operator: dotted name @ semver, e.g. sprisk.eval.binary_classification@1.0.0.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "OperatorRef".
 */
export type OperatorRef = string;
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
export type PortKind = "table" | "model" | "metrics" | "diagnostics" | "report";
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
 * Operator parameters. Validated against the operator's params_schema by the compiler, not here.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "Params".
 */
export interface Params {
  [k: string]: unknown;
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
  lease_expires_at: Timestamp;
}
/**
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "InputBinding".
 */
export interface InputBinding {
  port: PortName;
  artifact_id: ArtifactId;
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
