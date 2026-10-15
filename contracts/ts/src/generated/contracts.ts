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
