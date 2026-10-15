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
