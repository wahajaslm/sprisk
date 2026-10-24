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
 * Node name, unique within a pipeline version.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "NodeId".
 */
export type NodeId = string;
/**
 * explicit: user stated it. inferred: AI or rule guessed it. measured: computed from data. confirmed: user approved an inferred value.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "Origin".
 */
export type Origin = "explicit" | "inferred" | "measured" | "confirmed";
/**
 * A Python name a cell sets or reads.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "VariableName".
 */
export type VariableName = string;
/**
 * What an edited ready-made cell is (ADR-0055): the step with new settings, when only values changed, so it keeps its checks; otherwise code, and the step becomes a code step.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "NotebookSettings".
 */
export type NotebookSettings =
  | {
      reads_as: "settings";
      /**
       * The step's params, as the edited cell states them.
       */
      settings: {
        [k: string]: unknown;
      };
    }
  | {
      reads_as: "code";
    };
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
 * via the `definition` "MethodologyProposalId".
 */
export type MethodologyProposalId = string;
/**
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "MethodologyDecisionId".
 */
export type MethodologyDecisionId = string;
/**
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "NotebookId".
 */
export type NotebookId = string;
/**
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "NotebookVersionId".
 */
export type NotebookVersionId = string;
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
 * methodology.<pack>.<method>@<semver>
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "MethodRef".
 */
export type MethodRef = string;
/**
 * <area>.<decision>, the key other methods read a decision by.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "DecisionKey".
 */
export type DecisionKey = string;
/**
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "TaskType".
 */
export type TaskType = "exploration" | "classification" | "regression" | "undetermined";
/**
 * <pack>.<concept>, a meaning defined in a pack's concepts.yaml.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "ConceptId".
 */
export type ConceptId = string;
/**
 * <area>.<evidence>, a measured fact one operator produces.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "EvidenceKind".
 */
export type EvidenceKind = string;
/**
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "MethodOptionId".
 */
export type MethodOptionId = string;
/**
 * The one job a step does in a flow, so methods place and replace steps by role, and the engine builds a step of a role from its default operator, never by name (ADR-0064). score: scores a model on rows. score_shares: compares the class shares of train and test at the final score. cross_validate: scores a candidate on folds. select: chooses among compared candidates. row_filter: only drops rows.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "OperatorRole".
 */
export type OperatorRole =
  "source" | "split" | "model" | "score" | "score_shares" | "cross_validate" | "select" | "row_filter";
/**
 * A verification a method declares, the name of its verify_<name>() function.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "VerificationName".
 */
export type VerificationName = string;
/**
 * A field's value: a number, a yes or no, a short text, or a list of short texts (string_list).
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "EvidenceValue".
 */
export type EvidenceValue = number | boolean | string | string[];
/**
 * How a method's option was taken: confirmed, a person answered the method's ask; rule, the method chose it unasked.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "MethodAssurance".
 */
export type MethodAssurance = "confirmed" | "rule";
/**
 * The method session's one JSON line per request, tagged by `answer`: what decide() returned, what verify_<name>() found, or why the method refused its request. Any other failure ends the session.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "MethodAnswer".
 */
export type MethodAnswer = MethodDecided | MethodRefused | MethodVerified;
/**
 * What verify_<name>() found. pass: the promise holds. fail: it does not. inconclusive: the evidence cannot say, such as one side with no groups. Never stale: only the control plane knows what changed since.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "VerificationOutcome".
 */
export type VerificationOutcome = "pass" | "fail" | "inconclusive";
/**
 * label: what a model predicts; an all-rows step may never read it. text: free text. entity_identifier: groups rows of one real-world thing. time: when a row's event happened.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "ConceptKind".
 */
export type ConceptKind = "label" | "text" | "entity_identifier" | "time";
/**
 * column: a column of the loaded data. derived: a column a step adds.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "BindingSourceKind".
 */
export type BindingSourceKind = "column" | "derived";
/**
 * Who set the binding, tagged by assurance: a person stated it, or a method's option made it, confirmed by a person or set unasked by the method (rule).
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "BindingSetBy".
 */
export type BindingSetBy = BindingStated | BindingByMethod;
/**
 * How a split's folds are made when models are compared on its train rows (ADR-0064). plain: shuffled rows. group: whole values of the split's group_column. time: in order of the split's time_column, never reshuffled.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "SplitFolds".
 */
export type SplitFolds = "plain" | "group" | "time";
/**
 * all: reads every row, before the split, so it may never read a label concept. train: reads train rows only.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "OperatorScope".
 */
export type OperatorScope = "all" | "train";
/**
 * string_list: short values shown to people, such as the ids of overlapping groups.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "EvidenceFieldType".
 */
export type EvidenceFieldType = "integer" | "number" | "boolean" | "string" | "string_list";
/**
 * methodology.<pack>.<rule>@<semver>
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "MethodologyRuleRef".
 */
export type MethodologyRuleRef = string;
/**
 * The rule session's one JSON line per RuleRequest, tagged by `answer`: the rule's decision, or why the rule refused its observation. Any other failure ends the session.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "RuleAnswer".
 */
export type RuleAnswer = RuleDecided | RuleRefused;
/**
 * Stages in decision order (ADR-0059): the split comes before cleaning, since cleaning rules measure train rows.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "MethodologyStage".
 */
export type MethodologyStage =
  "question" | "data" | "split" | "cleaning" | "features" | "models" | "evaluation" | "reporting";
/**
 * What choosing an alternative does to the flow. Rust builds graph effects for replace_node, remove_node (ADR-0043) and insert_step before the rule's step (ADR-0057); reopen changes nothing in the flow: recommended, it makes the review item `reopen` for the stage its params name (ADR-0059). The others describe actions not wired yet. A new type is a contract change, so a typo cannot pass as a silent no-op.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "RuleActionType".
 */
export type RuleActionType =
  | "replace_node"
  | "remove_node"
  | "insert_step"
  | "pass_through"
  | "update_estimator_params"
  | "configure_clustering_cardinality"
  | "configure_clustering_distance"
  | "configure_dbscan_params"
  | "configure_evaluation_params"
  | "emit_methodology_limitation"
  | "enforce_compiler_invariant"
  | "reopen";
/**
 * Typed mutation previewed and compiled before it can create a pipeline version.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "GraphEffect".
 */
export type GraphEffect =
  | {
      kind: "replace_node";
      node_id: NodeId;
      operator: OperatorRef;
      params: Params;
    }
  | {
      kind: "remove_node";
      node_id: NodeId;
    }
  | {
      kind: "insert_node";
      node_id: NodeId;
      operator: OperatorRef;
      params: Params;
      before: NodeId;
      /**
       * A step that joins: the output feeding its `other` input, a source table no step read before (ADR-0059). Absent for a step with one input.
       */
      other?: string;
    }
  | {
      kind: "add_node";
      node_id: NodeId;
      operator: OperatorRef;
      params: Params;
      inputs: {
        [k: string]: PortRef;
      };
    }
  | {
      kind: "set_input";
      node_id: NodeId;
      port: PortName;
      from: PortRef;
    };
/**
 * `<node_id>.<port_name>`.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "PortRef".
 */
export type PortRef = string;
/**
 * Pinned rule: <pack>.<rule>@<semver>.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "CheckRef".
 */
export type CheckRef = string;
/**
 * settled: the flow matches the rule's decision. proposal: the rule wants a change. needs_fact: a person must state a fact. needs_run: it measures train rows the flow has not produced. waiting: an earlier open item changes what it reads. no_subject: no step for it to decide yet. not_applicable: the rule does not apply to this step. reopen: cross-validation results say the stage in `reopens` must change; it stays open until the flow does (ADR-0059).
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "MethodologyReviewStatus".
 */
export type MethodologyReviewStatus =
  "settled" | "proposal" | "needs_fact" | "needs_run" | "waiting" | "no_subject" | "not_applicable" | "reopen";
/**
 * Immutable record of one decision made through Apply: a rule's alternative, or a method's option (ADR-0064).
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "MethodologyDecision".
 */
export type MethodologyDecision = MethodologyDecisionByRule | MethodologyDecisionByMethod;
/**
 * Stable within a notebook across versions, as in Jupyter's nbformat 4.5.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "NotebookCellId".
 */
export type NotebookCellId = string;
/**
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "RunStatus".
 */
export type RunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";
/**
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "MethodologyCheckId".
 */
export type MethodologyCheckId = string;
/**
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "MethodologyPhase".
 */
export type MethodologyPhase = "plan" | "code" | "runtime" | "result" | "release";
/**
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "MethodologyCoverage".
 */
export type MethodologyCoverage = "complete" | "partial" | "not_assessed";
/**
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "Verdict".
 */
export type Verdict = "pass" | "fail" | "warning" | "not_assessed";
/**
 * One line of a cell's execution as it happens (ADR-0041), from the session host to Rust and, when asked with Accept: application/x-ndjson, from POST /notebooks/{id}/execute to the browser. Tagged by `kind`: `running` lines carry every output so far; the last line is `done`, or `failed` when the kernel stopped answering after the stream began (earlier failures are an HTTP error).
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "NotebookExecutionEvent".
 */
export type NotebookExecutionEvent = ExecutionRunning | ExecutionDone | ExecutionFailed;
/**
 * Rust to the session host, one JSON line each (ADR-0036). Tagged by `op`. The host answers execute with NotebookExecutionEvent lines ending in `done` (ADR-0041) and variables with NotebookVariables; interrupt and shutdown get no answer.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "NotebookKernelRequest".
 */
export type NotebookKernelRequest = KernelExecute | KernelInterrupt | KernelVariables | KernelShutdown;
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
 * What a port carries. A table is Parquet; a matrix is rows by named number columns, stored sparse (SciPy CSR in .npz, ADR-0058): row i is row i of the table it was made from.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "PortKind".
 */
export type PortKind = "table" | "matrix" | "model" | "metrics" | "diagnostics" | "report" | "figure";
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
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "Entrypoint".
 */
export type Entrypoint = string;
/**
 * How a model operator's fit reacts to its inputs, for preparation rules: tree_ensemble splits on rank order; linear and distance_based depend on scale and outliers; density_based depends on scale and marks isolated rows as noise.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "ModelFamily".
 */
export type ModelFamily = "tree_ensemble" | "linear" | "distance_based" | "density_based";
/**
 * A flow's stages in order; each is one notebook (ADR-0055). Load reads the data and looks at all rows; Explore looks at the training rows, after the split.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "Stage".
 */
export type Stage = "load" | "split" | "explore" | "clean" | "model" | "evaluate";
/**
 * Fixed before any score is seen: balanced_accuracy (higher is better) for classification, expected_cost per row (lower is better) when the model step states costs (ADR-0053), rmse (lower is better) for regression. weighted_f1 (higher is better; F1 per class weighted by its share of rows) for classification when a person states it with the success bar (ADR-0059).
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "SelectionMetric".
 */
export type SelectionMetric = "balanced_accuracy" | "expected_cost" | "rmse" | "weighted_f1";
/**
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "ReportId".
 */
export type ReportId = string;
/**
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "WalkId".
 */
export type WalkId = string;
/**
 * One record a claim rests on, by id.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "ReportEvidence".
 */
export type ReportEvidence =
  | {
      decision: MethodologyDecisionId;
    }
  | {
      run: RunId;
    }
  | {
      pipeline_version: PipelineVersionId;
    }
  | {
      walk_step: WalkStepRef;
    };
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
 * What the baseline is for. floor: a model that ignores its features; it never wins, so no winner means no model beats it. reference: the rule's recommendation; it stands unless another alternative beats it (ADR-0050).
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "BaselineRole".
 */
export type BaselineRole = "floor" | "reference";
/**
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "StudyId".
 */
export type StudyId = string;
/**
 * grid: every combination of the manifest's values. random: a seeded sample of them, without replacement (ADR-0052).
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "StudyStrategy".
 */
export type StudyStrategy = "grid" | "random";
/**
 * running: its run has not ended. completed: the select step decided. budget_reached: the wall-time budget ran out; finished trials are kept and nothing is decided. failed: a step failed after its retries.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "StudyStatus".
 */
export type StudyStatus = "running" | "completed" | "budget_reached" | "failed";
/**
 * Read from its attempts. not_started: none yet. running: one is in flight, or a retry is due. succeeded: one succeeded or reused a cached result. failed or cancelled: the run ended without a success.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "TrialState".
 */
export type TrialState = "not_started" | "running" | "succeeded" | "failed" | "cancelled";
/**
 * Local CSV or Parquet files, inside an allowed data folder, read as file_source steps. The first holds the rows to predict on; any other is joined to it by a rule.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "WalkSources".
 */
export type WalkSources = string[];
/**
 * walking: it has more to do. stopped: it ended, for the reason in `stop`.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "WalkStatus".
 */
export type WalkStatus = "walking" | "stopped";
/**
 * complete: nothing is open. needs_person: only facts a person must state are open. limitation: a rule's recommended route reports a limit, such as no lift over the baseline. uncovered: an open item has no engine action yet. source_changed: a source file no longer holds what it held when the walk began. run_failed: the head's run failed and no rule can act on what it produced. stale: the head gained a version the walk did not make. budget_exhausted: the walk used its actions or its time. unverified: every rule is settled, but a promise a decision made did not pass on the head's run, so the test rows stay sealed. error: the engine could not take its next step; the detail says why.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "WalkStopReason".
 */
export type WalkStopReason =
  | "complete"
  | "needs_person"
  | "limitation"
  | "uncovered"
  | "source_changed"
  | "run_failed"
  | "stale"
  | "unverified"
  | "budget_exhausted"
  | "error";
/**
 * build: made the first version from the question and sources. run: ran a version. apply: applied a rule's recommended alternative. compare: compared a Try's routes on fixed folds. measure: added or moved the steps that measure the evidence methods need, where each one attaches (ADR-0063). decide: a method chose an option, or applied a person's answer, and patched the flow by it. score: once every rule was settled, added one Evaluate on the test rows and ran it, once; no rule reads its score. verify: checked each promise the walk's decisions made, on the evidence the head's run measured (ADR-0063). stop: ended the walk.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "WalkAction".
 */
export type WalkAction = "build" | "run" | "apply" | "compare" | "measure" | "decide" | "score" | "verify" | "stop";
/**
 * pass, fail, inconclusive: what verify_<name>() found. not_evaluated: no step measured the evidence it needs. Stale is never recorded: it is worked out against a newer version.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "PromiseResult".
 */
export type PromiseResult = "pass" | "fail" | "inconclusive" | "not_evaluated";
/**
 * pass, fail, inconclusive, not_evaluated: what the last check found, and it still holds for this version. stale: the step that measured it, or a step before it, changed since; never shown as pass.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "PromiseStanding".
 */
export type PromiseStanding = "pass" | "fail" | "inconclusive" | "not_evaluated" | "stale";
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
  /**
   * Reuse this run's results for every step whose definition is unchanged; run the rest (ADR-0026). Omitted: run from the start.
   */
  reuse_run_id?: string;
  /**
   * Run this step and every step after it again, even where unchanged; reuse or take from the cache only the steps before it (ADR-0026 amendment). It must be a step of the version. Omitted: only changed steps run.
   */
  run_from_node_id?: string;
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
 * A table a flow loads (ADR-0038), as listed by GET /loaded_tables: the latest output of a source step. Tables with the same content are one entry. Derived from run history; not the Dataset entity of arch §4, which keeps that name.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "LoadedTable".
 */
export interface LoadedTable {
  /**
   * The file name the source step reads, or the step's id when it reads no file.
   */
  name: string;
  operator: OperatorRef;
  artifact: Artifact;
  total_rows: number;
  total_columns: number;
  used_by: LoadedTableUse[];
}
/**
 * A step that loads the table, in the latest run of its version that loaded it.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "LoadedTableUse".
 */
export interface LoadedTableUse {
  pipeline_version_id: PipelineVersionId;
  /**
   * The latest run of that version, whose source step loaded the table.
   */
  run_id: string;
  node_id: NodeId;
}
/**
 * How the rows a step reads match another table, per column both share (ADR-0059), computed by Python on all rows: structure, nothing fitted. Methodology rules read it to decide a join.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "KeyMatches".
 */
export interface KeyMatches {
  schema_version: "sprisk.key_matches/v1";
  /**
   * Rows of the table the step reads.
   */
  rows: number;
  /**
   * Rows of the other table.
   */
  other_rows: number;
  /**
   * Each column both tables share, in the step's column order; at most 200.
   */
  keys: KeyMatch[];
}
/**
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "KeyMatch".
 */
export interface KeyMatch {
  /**
   * Dataset text: a column name both tables have.
   */
  column: string;
  /**
   * Rows of the step's table whose value finds a row of the other table. Missing values never match.
   */
  matched_rows: number;
  /**
   * The most rows of the other table that share one value: above 1, a join would copy rows.
   */
  most_rows_per_key: number;
}
/**
 * A descriptive profile of one table (GET /artifacts/{id}/profile, ADR-0038), computed by Python. Bounded: at most the first 200 columns and 1,000,000 rows, histograms of at most 20 bars, a missing-value map of at most 40 row bands, correlation of at most 30 columns. The AI planner never reads it. Methodology rules read it of a step's train rows, and only its structure (types, duplicates, values that fail to convert) of the rows before the split (ADR-0059).
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "DatasetProfile".
 */
export interface DatasetProfile {
  total_rows: number;
  total_columns: number;
  /**
   * Rows the profile covers: all of them, or the first 1,000,000 of a larger table.
   */
  profiled_rows: number;
  /**
   * Rows in each band of the missing-value map; the last band may hold fewer.
   */
  band_rows: number;
  /**
   * Profiled rows equal in every column to an earlier one.
   */
  duplicate_rows?: number;
  columns: ColumnProfile[];
  correlation: Correlation;
}
/**
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "ColumnProfile".
 */
export interface ColumnProfile {
  name: string;
  /**
   * Polars data type name, for display only.
   */
  data_type: string;
  /**
   * Empty cells, NaN and infinity.
   */
  missing: number;
  /**
   * Distinct values, not counting missing.
   */
  distinct: number;
  /**
   * Sample skewness of a numeric column with variation; absent otherwise.
   */
  skewness?: number;
  /**
   * Excess (Fisher) kurtosis of a numeric column with variation; absent otherwise.
   */
  kurtosis?: number;
  /**
   * Share of present values outside the 1.5 x IQR fences, for a numeric column with variation.
   */
  outlier_share?: number;
  /**
   * Interquartile range of a numeric column with variation. Zero when most values are equal: IQR fences and robust scaling then have no spread to use.
   */
  iqr?: number;
  /**
   * Of a text column's distinct values, how many merge with another once spaces and case are ignored ('Paris', 'paris '). Absent for other columns.
   */
  case_variants?: number;
  /**
   * How many more of a text column's distinct values merge once accents are also ignored ('café', 'cafe'). Absent for other columns.
   */
  accent_variants?: number;
  /**
   * For a column with at most 20 distinct values, the share of present values held by its least common value, such as the rarest class of a target. Absent for other columns.
   */
  rarest_share?: number;
  /**
   * Of a text column's present values, the share that read as numbers. Absent for other columns.
   */
  numeric_share?: number;
  /**
   * Of a text column's present values, the share holding more than one word: free text, not a code such as an identifier (ADR-0059). Absent for other columns.
   */
  word_share?: number;
  /**
   * Of a text column's present values, the share holding an HTML tag (<br />) or entity (&eacute;): markup, not words (ADR-0059). Absent for other columns.
   */
  html_share?: number;
  /**
   * Of a text column's present values, how many read as numbers but start with a zero before a digit, like the code 01234. Absent for other columns.
   */
  leading_zero_values?: number;
  /**
   * A text column's most common present values that do not read as numbers, most common first, when some do. Dataset text (untrusted, rule 7), cut to 60 characters.
   *
   * @maxItems 10
   */
  unconverted?:
    | []
    | [string]
    | [string, string]
    | [string, string, string]
    | [string, string, string, string]
    | [string, string, string, string, string]
    | [string, string, string, string, string, string]
    | [string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string];
  /**
   * Share of missing cells (0 to 1) in each row band, in row order.
   */
  missing_by_band: number[];
  histogram?: Histogram;
}
/**
 * Absent when every value is missing.
 */
export interface Histogram {
  /**
   * bins: equal-width bins of a numeric column. top_values: the most common values of any other column.
   */
  kind: "bins" | "top_values";
  bars: HistogramBar[];
}
/**
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "HistogramBar".
 */
export interface HistogramBar {
  label: string;
  count: number;
}
/**
 * Pearson correlation of numeric columns that vary (at most 30). Each pair uses the rows where both are present; a pair with fewer than 10 such rows, or with no variation on them, is left out.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "Correlation".
 */
export interface Correlation {
  columns: string[];
  pairs: CorrelationPair[];
}
/**
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "CorrelationPair".
 */
export interface CorrelationPair {
  column_a: string;
  column_b: string;
  pearson: number;
  /**
   * Rows where both columns are present.
   */
  rows: number;
}
/**
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "Histogram".
 */
export interface Histogram1 {
  /**
   * bins: equal-width bins of a numeric column. top_values: the most common values of any other column.
   */
  kind: "bins" | "top_values";
  bars: HistogramBar[];
}
/**
 * Figures a step drew (ADR-0024), converted by the worker: matplotlib as SVG text, Plotly as its figure JSON text. GET /artifacts/{id}/figures returns the first ones from a figures or display report, without the tables a code step showed.
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
  library: "matplotlib" | "plotly" | "altair";
  format: "svg" | "plotly_json" | "vega_lite_json";
  title?: string;
  /**
   * SVG markup, a Plotly figure as JSON text, or a Vega-Lite spec as JSON text (Altair).
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
  kind: "text" | "table" | "image" | "figure";
  /**
   * Present for kind text.
   */
  text?: string;
  table?: TablePage1;
  figure?: Figure1;
  /**
   * Present for kind image: a PNG, base64-encoded. Written by older code steps; new ones write figures.
   */
  png_base64?: string;
  /**
   * The code that was shown, as written: a name such as summary, or an expression such as df.head(). Absent for printed text, figures shown at the end, and older code steps.
   */
  label?: string;
  /**
   * The line of the step's code that showed it: a show() or display() call, or the last line. Absent when it was shown at the end of the run, or by older code steps.
   */
  line?: number;
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
 * Present for kind figure: a plot the code drew, as SVG, Plotly or Vega-Lite (ADR-0024).
 */
export interface Figure1 {
  library: "matplotlib" | "plotly" | "altair";
  format: "svg" | "plotly_json" | "vega_lite_json";
  title?: string;
  /**
   * SVG markup, a Plotly figure as JSON text, or a Vega-Lite spec as JSON text (Altair).
   */
  content: string;
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
  /**
   * For tables: their columns with type and missing count, for the Data tab's variable explorer (ADR-0030). Capped.
   */
  fields?: CodeField[];
  sample?: TablePage2;
  /**
   * For other values: their repr, cut to a bounded length (ADR-0030).
   */
  text?: string;
}
/**
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "CodeField".
 */
export interface CodeField {
  name: string;
  /**
   * Polars data type name, for display only.
   */
  data_type: string;
  null_count: number;
}
/**
 * For tables: the first rows (ADR-0030). Omitted once the report's size budget is used up.
 */
export interface TablePage2 {
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
 * Notebook cells to split into code steps (ADR-0031), in notebook order. Body of POST /code/split. Never executed.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "CodeSplitRequest".
 */
export interface CodeSplitRequest {
  cells: string[];
  together?: CellRange;
}
/**
 * Cells first..last (from 0) start as one step: the cells a person picked for Create node (ADR-0036). Absent: every cell starts alone.
 */
export interface CellRange {
  first: number;
  last: number;
}
/**
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "CellRange".
 */
export interface CellRange1 {
  first: number;
  last: number;
}
/**
 * Code steps read from notebook cells (ADR-0031): each step's source, the cells it holds and the tables it reads and passes on, the links between steps, and notes for the person. A suggestion they confirm before a flow is made.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "CodeSplit".
 */
export interface CodeSplit {
  steps: SplitStep[];
  links: SplitLink[];
  notes: SplitNote[];
}
/**
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "SplitStep".
 */
export interface SplitStep {
  /**
   * The step's code: its cells, with the imports and literals it uses from earlier cells copied in.
   */
  source: string;
  /**
   * Top-level literals in the step's code, its own or copied in, that can be exposed as settings.
   */
  parameters: SplitParameter[];
  /**
   * Indexes (from 0) of the cells this step holds.
   */
  cells: number[];
  inputs: PortName[];
  outputs: PortName[];
}
/**
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "SplitParameter".
 */
export interface SplitParameter {
  name: string;
  value: number | string | boolean;
}
/**
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "SplitLink".
 */
export interface SplitLink {
  from_step: number;
  to_step: number;
  name: PortName;
}
/**
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "SplitNote".
 */
export interface SplitNote {
  /**
   * Index (from 0) of the cell the note is about.
   */
  cell: number;
  message: string;
}
/**
 * A ready-made step's settings and the variables its inputs and outputs go by. Body of POST /operators/{id}/notebook_code (ADR-0055).
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "NotebookCodeRequest".
 */
export interface NotebookCodeRequest {
  /**
   * The step's params as the flow has them.
   */
  settings: {
    [k: string]: unknown;
  };
  /**
   * The variable each input port reads, by port.
   */
  inputs: {
    [k: string]: VariableName;
  };
  /**
   * The variable each output port sets, by port.
   */
  outputs: {
    [k: string]: VariableName;
  };
}
/**
 * A ready-made step's settings, the variables its ports go by, and its cell as a person edited it. Body of POST /operators/{id}/notebook_settings (ADR-0055).
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "NotebookSettingsRequest".
 */
export interface NotebookSettingsRequest {
  /**
   * The step's params as the flow has them.
   */
  settings: {
    [k: string]: unknown;
  };
  /**
   * The variable each input port reads, by port.
   */
  inputs: {
    [k: string]: VariableName;
  };
  /**
   * The variable each output port sets, by port.
   */
  outputs: {
    [k: string]: VariableName;
  };
  /**
   * The cell as edited.
   */
  code: string;
}
/**
 * A ready-made step written as plain Python for a notebook cell (ADR-0055).
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "NotebookCode".
 */
export interface NotebookCode {
  code: string;
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
 * A method's method.yaml (ADR-0063): the decision it owns, what it needs, its options and what each option promises. Its method.py holds decide() and one verify_<name>() per verification.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "Method".
 */
export interface Method {
  schema_version: "sprisk.method/v1";
  id: MethodRef;
  decides: DecisionKey;
  /**
   * The group this decision is shown in: one stage card on the canvas, one notebook section.
   */
  activity: string;
  /**
   * The decision as a question for people.
   */
  question: string;
  applies_when?: MethodAppliesWhen;
  needs: MethodNeeds;
  options: MethodOption[];
  /**
   * Promises an option can make, by name. An option lists the ones it makes in verify.
   */
  verifications: {
    [k: string]: MethodVerification;
  };
  /**
   * The published standard the method follows.
   */
  source: string;
}
/**
 * When the method applies. Absent: always.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "MethodAppliesWhen".
 */
export interface MethodAppliesWhen {
  task: TaskType[];
}
/**
 * Everything decide() may read. It reads nothing else.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "MethodNeeds".
 */
export interface MethodNeeds {
  concepts: ConceptId[];
  evidence: EvidenceKind[];
  decisions: DecisionKey[];
}
/**
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "MethodOption".
 */
export interface MethodOption {
  id: MethodOptionId;
  label: string;
  action?: MethodAction;
  /**
   * The verifications this option promises, by name.
   */
  verify: VerificationName[];
}
/**
 * What the option changes. Absent: nothing.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "MethodAction".
 */
export interface MethodAction {
  bind?: MethodBind;
  replace?: MethodReplace;
  insert?: MethodInsert;
}
/**
 * Binds a concept to a column that the producer of an evidence kind adds.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "MethodBind".
 */
export interface MethodBind {
  concept: ConceptId;
  evidence: EvidenceKind;
  /**
   * A column the producer writes, never a dataset column.
   */
  column: string;
}
/**
 * Replaces the step with this role by a step running operator.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "MethodReplace".
 */
export interface MethodReplace {
  role: OperatorRole;
  operator: OperatorRef;
  settings?: Params1;
  /**
   * Params a project's binding fills: param name to concept. A param the operator already maps to a concept is not listed here. Absent: none.
   */
  concepts?: {
    [k: string]: ConceptId;
  };
}
/**
 * Params that do not depend on the project. Absent: none.
 */
export interface Params1 {
  [k: string]: unknown;
}
/**
 * Inserts a step running operator on the rows the step with role `before` reads (ADR-0063 slice 6).
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "MethodInsert".
 */
export interface MethodInsert {
  before: OperatorRole;
  operator: OperatorRef;
  /**
   * The inserted step's id; a free one with a suffix when the flow already has it.
   */
  node_id: string;
  settings?: Params2;
  /**
   * Params read from a field of evidence the method needs: param name to <area>.<evidence>.<field>. Absent: none.
   */
  from_evidence?: {
    [k: string]: string;
  };
  /**
   * Params a project's binding fills: param name to concept. Absent: none.
   */
  concepts?: {
    [k: string]: ConceptId;
  };
}
/**
 * Params that do not depend on the project. Absent: none.
 */
export interface Params2 {
  [k: string]: unknown;
}
/**
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "MethodVerification".
 */
export interface MethodVerification {
  needs: EvidenceKind;
  /**
   * What holds when it passes, for people.
   */
  promise: string;
  settings?: Params3;
}
/**
 * Values verify_<name>() reads. Absent: none.
 */
export interface Params3 {
  [k: string]: unknown;
}
/**
 * Rust to the method session (`python -m sprisk_workers.method`), one JSON line per decision (ADR-0063): the method module Rust picked from the loaded catalog, and only what its needs declare. decide() may read nothing else.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "MethodRequest".
 */
export interface MethodRequest {
  schema_version: "sprisk.method_request/v1";
  /**
   * Path of the method's method.py, from the catalog Rust loaded; never from a client. A local path, so this message is only for the method process on the same machine, never stored.
   */
  module: string;
  method: MethodRef;
  needs: MethodNeeds;
  /**
   * The ids of the method's options: decide() chooses or asks for one of them.
   */
  options: MethodOptionId[];
  task: TaskType;
  evidence: EvidenceSet;
  /**
   * Each needed decision, by its key: the option chosen.
   */
  decisions: {
    [k: string]: MethodOptionId;
  };
  /**
   * The needed concepts a stated, confirmed or method-made binding names. Never a column name.
   */
  bound: ConceptId[];
}
/**
 * Each needed kind that was measured. A needed kind left out cannot be measured, because its producer reads a concept no binding names.
 */
export interface EvidenceSet {
  [k: string]: EvidenceFields;
}
/**
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "EvidenceFields".
 */
export interface EvidenceFields {
  [k: string]: EvidenceValue;
}
/**
 * Rust to the method session, one JSON line per promise to check (ADR-0063): the method module Rust picked from the loaded catalog, the verification's name, the fields of the one evidence kind it needs, as the step's producer measured them, and its settings. verify_<name>() may read nothing else.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "VerificationRequest".
 */
export interface VerificationRequest {
  schema_version: "sprisk.verification_request/v1";
  /**
   * Path of the method's method.py, from the catalog Rust loaded; never from a client. A local path, so this message is only for the method process on the same machine, never stored.
   */
  module: string;
  method: MethodRef;
  verification: VerificationName;
  evidence: EvidenceFields1;
  settings: Params4;
}
/**
 * The fields of the evidence kind the verification needs.
 */
export interface EvidenceFields1 {
  [k: string]: EvidenceValue;
}
/**
 * The verification's settings from method.yaml; empty when it has none.
 */
export interface Params4 {
  [k: string]: unknown;
}
/**
 * Read-only files of one method folder (ADR-0063): its method.yaml and method.py, as the packs loaded them, so a person sees the code that decides and checks a step. Served by GET /methods/{id}/source; the API reads only files inside the method's folder.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "MethodFiles".
 */
export interface MethodFiles {
  method: MethodRef;
  files: {
    /**
     * Relative to the method folder, e.g. method.yaml. Never an absolute path.
     */
    path: string;
    language: "yaml" | "python";
    text: string;
  }[];
}
/**
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "MethodDecided".
 */
export interface MethodDecided {
  answer: "decided";
  method: MethodRef;
  /**
   * choose: the method applies the option. ask: a person confirms the option, or picks another, before anything relies on it.
   */
  outcome: "choose" | "ask";
  option: MethodOptionId;
  /**
   * Why, for a person. For ask, the question itself.
   */
  reason: string;
}
/**
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "MethodRefused".
 */
export interface MethodRefused {
  answer: "refused";
  /**
   * The method's own error (an undeclared read, an unknown option). It may name local paths, so it goes to the log, not to a client.
   */
  error: string;
}
/**
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "MethodVerified".
 */
export interface MethodVerified {
  answer: "verified";
  method: MethodRef;
  verification: VerificationName;
  result: VerificationOutcome;
  /**
   * What the evidence showed, for a person.
   */
  detail: string;
}
/**
 * A person's answer to a method's ask (ADR-0063 amendment): the option to apply for the decision. The walk applies it with assurance confirmed.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "DecisionAnswer".
 */
export interface DecisionAnswer {
  decides: DecisionKey;
  option: MethodOptionId;
}
/**
 * A pack's concepts.yaml (ADR-0063): the meanings its methods and operators may ask for. Served by GET /concepts with the concepts of every loaded pack.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "ConceptSet".
 */
export interface ConceptSet {
  schema_version: "sprisk.concept_set/v1";
  concepts: {
    [k: string]: Concept;
  };
}
/**
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "Concept".
 */
export interface Concept {
  kind: ConceptKind;
  description: string;
  binds_to: BindingSourceKind[];
}
/**
 * Which column means a concept in one project (ADR-0063). Column names live only here.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "Binding".
 */
export interface Binding {
  schema_version: "sprisk.binding/v1";
  concept: ConceptId;
  source: BindingSource;
  set_by: BindingSetBy;
}
/**
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "BindingSource".
 */
export interface BindingSource {
  column: string;
  /**
   * Node name, unique within a pipeline version.
   */
  step?: string;
}
/**
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "BindingStated".
 */
export interface BindingStated {
  assurance: "stated";
}
/**
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "BindingByMethod".
 */
export interface BindingByMethod {
  assurance: MethodAssurance;
  method: MethodRef;
}
/**
 * Where the engine adds an evidence producer: on the rows going into (input) or coming out of (output) the step with this role.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "OperatorAttach".
 */
export interface OperatorAttach {
  role: OperatorRole;
  side: "input" | "output";
}
/**
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "EvidenceProduced".
 */
export interface EvidenceProduced {
  /**
   * The producer the engine adds when several operators produce this kind. Absent: false.
   */
  default?: boolean;
  fields: {
    [k: string]: EvidenceFieldType;
  };
}
/**
 * What one evidence producer measured, written to its output port named evidence (ADR-0063): each kind it produces, with each field's value. The operator's produces says which kinds and fields, of which types; the control plane checks the file against it when the step's outputs are saved.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "EvidenceSet".
 */
export interface EvidenceSet1 {
  [k: string]: EvidenceFields;
}
/**
 * What a rule's decide() reads (ADR-0042): confirmed question facts and measured profile values, never raw rows, plus its settings. Sent by Rust to the Python rule runner.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "RuleObservation".
 */
export interface RuleObservation {
  schema_version: "sprisk.rule_observation/v1";
  rule: MethodologyRuleRef;
  /**
   * Facts by name: question facts (question.time_column), facts read from the flow (flow.model_families), and the step's own text settings (step.method). A fact that lists several values joins them, sorted, with ', '.
   */
  facts: {
    [k: string]: Fact;
  };
  /**
   * Measured profile values by name. A list holds dataset text, such as the values of a column that do not read as numbers.
   */
  profile: {
    [k: string]:
      | number
      | string
      | boolean
      | []
      | [string]
      | [string, string]
      | [string, string, string]
      | [string, string, string, string]
      | [string, string, string, string, string]
      | [string, string, string, string, string, string]
      | [string, string, string, string, string, string, string]
      | [string, string, string, string, string, string, string, string]
      | [string, string, string, string, string, string, string, string, string]
      | [string, string, string, string, string, string, string, string, string, string];
  };
  /**
   * The rule's settings: policy thresholds with any overrides.
   */
  settings: {
    [k: string]: unknown;
  };
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
 * What a rule's decide() returns (ADR-0042). Rust builds graph effects from it with the manifest's actions; it never runs as code.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "RuleDecision".
 */
export interface RuleDecision {
  schema_version: "sprisk.rule_decision/v1";
  rule: MethodologyRuleRef;
  /**
   * The one alternative a recommend rule picks; absent for a shortlist rule.
   */
  recommended_alternative_id?: string;
  /**
   * The alternatives a shortlist rule puts forward to compare; absent for a recommend rule (ADR-0044).
   */
  shortlist?: string[];
  /**
   * @minItems 1
   */
  alternatives: [
    {
      id: string;
      applicability: "applicable" | "needs_fact" | "not_applicable";
      reason: string;
      params?: Params5;
    },
    ...{
      id: string;
      applicability: "applicable" | "needs_fact" | "not_applicable";
      reason: string;
      params?: Params5;
    }[]
  ];
  evidence: MethodologyEvidence[];
}
/**
 * Concrete params for the manifest action's operator; present when applicable.
 */
export interface Params5 {
  [k: string]: unknown;
}
/**
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "MethodologyEvidence".
 */
export interface MethodologyEvidence {
  kind: "question_fact" | "profile_fact" | "flow_fact" | "policy" | "user_reason";
  label: string;
  value: string;
  origin: Origin;
  artifact_id?: ArtifactId;
}
/**
 * Rust to the rule session (`python -m sprisk_workers.rule`), one JSON line per decision (ADR-0059): the rule module Rust picked from the loaded catalog, and its observation. One session serves a whole review.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "RuleRequest".
 */
export interface RuleRequest {
  schema_version: "sprisk.rule_request/v1";
  /**
   * Path of the rule's rule.py, from the catalog Rust loaded; never from a client. A local path, so this message is only for the rule process on the same machine, never stored.
   */
  module: string;
  observation: RuleObservation;
}
/**
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "RuleDecided".
 */
export interface RuleDecided {
  answer: "decided";
  decision: RuleDecision;
}
/**
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "RuleRefused".
 */
export interface RuleRefused {
  answer: "refused";
  /**
   * The rule's own error (a broken observation, a module with no decide). It may name local paths, so it goes to the log, not to a client.
   */
  error: string;
}
/**
 * The declarative manifest of one methodology rule package (ADR-0042), loaded from methodology/<pack>/rules/<rule>/rule.yaml. Served read-only by GET /methodology_rules.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "MethodologyRule".
 */
export interface MethodologyRule {
  schema_version: "sprisk.methodology_rule/v1";
  id: MethodologyRuleRef;
  name: string;
  stage: MethodologyStage;
  /**
   * recommend (the default): decide() picks one alternative. shortlist: it puts forward the registry's models worth comparing (ADR-0044).
   */
  selection?: "recommend" | "shortlist";
  /**
   * draft: a design with no rule.py, never run; its condition and observes are notes. active: has rule.py, applies_to, reads and examples, and no notes (ADR-0045).
   */
  status: "draft" | "active";
  /**
   * Operators, without version, whose steps this active rule decides. Rust routes from it (ADR-0045).
   */
  applies_to?: string[];
  /**
   * Facts this active rule may read, by name from the fact catalog, e.g. question.target or column.*.kurtosis; * stands for a column or setting name. Rust sends only these (ADR-0045).
   */
  reads?: string[];
  /**
   * Inputs and the alternative decide() picks for them. Run as tests and shown in place of conditions (ADR-0045).
   */
  examples?: RuleExample[];
  /**
   * The decision as a person asks it, e.g. How should missing values be filled? Shown on the Methodology page; nothing that decides reads it. Required on an active rule (ADR-0045 amendment).
   */
  question?: string;
  /**
   * The one decision this rule owns; unique across loaded packs.
   */
  decides: string;
  provenance: {
    standard: string;
    citation: string;
    pitfall: string;
    corner_cases: string[];
  };
  /**
   * Design notes on a draft rule's inputs; an active rule declares reads instead.
   */
  observes?: (
    | {
        profile: string;
        description: string;
        required: boolean;
      }
    | {
        fact: string;
        description: string;
        required: boolean;
      }
  )[];
  /**
   * Default thresholds the rule decides with.
   */
  policy_thresholds: {
    [k: string]: unknown;
  };
  /**
   * A recommend rule's menu. A shortlist rule has none: its candidates come from the registry (ADR-0044).
   */
  alternatives: {
    id: string;
    label: string;
    description: string;
    /**
     * A draft rule's design note on when this applies. An active rule has none: its decide() is the logic, shown by its examples (ADR-0045).
     */
    condition?: string;
    /**
     * In a few words, when the rule takes this route, e.g. the column is skewed. Shown beside the example that picks it; nothing that decides reads it. Required on an active rule's alternatives (ADR-0045 amendment).
     */
    when?: string;
    rationale: string;
    /**
     * JSON Schema for this alternative's settings.
     */
    settings_schema?: {};
    action: {
      type: RuleActionType;
      /**
       * Operator the action builds; may name one not yet registered.
       */
      operator?: string;
      placement?: string;
      /**
       * Node name, unique within a pipeline version.
       */
      node_id?: string;
      fit_on?: string;
      apply_to?: string;
      /**
       * Operator params; '{settings.x}' strings are filled from the alternative's settings.
       */
      params?: {};
    };
  }[];
  verification: {
    check_id: string;
    invariant: string;
  };
}
/**
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "RuleExample".
 */
export interface RuleExample {
  /**
   * Facts by name. A question fact is confirmed and a flow fact measured unless given as { value, origin }. A measured fact may also be a list of dataset text.
   */
  given: {
    [k: string]:
      | string
      | number
      | []
      | [string]
      | [string, string]
      | [string, string, string]
      | [string, string, string, string]
      | [string, string, string, string, string]
      | [string, string, string, string, string, string]
      | [string, string, string, string, string, string, string]
      | [string, string, string, string, string, string, string, string]
      | [string, string, string, string, string, string, string, string, string]
      | [string, string, string, string, string, string, string, string, string, string]
      | {
          value: string;
          origin: Origin;
        };
  };
  /**
   * What a recommend rule picks.
   */
  picks?: string;
  /**
   * What a shortlist rule puts forward.
   */
  shortlist?: string[];
}
/**
 * Read-only files of one rule package: its manifest and, when present, its Python decide() module. Served by GET /methodology_rules/{id}/source; the API reads only files inside the rule's folder.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "MethodologyRuleSource".
 */
export interface MethodologyRuleSource {
  rule: MethodologyRuleRef;
  /**
   * @minItems 1
   */
  files: [
    {
      /**
       * Relative to the rule folder, e.g. rule.yaml. Never an absolute path.
       */
      path: string;
      language: "yaml" | "python";
      text: string;
    },
    ...{
      /**
       * Relative to the rule folder, e.g. rule.yaml. Never an absolute path.
       */
      path: string;
      language: "yaml" | "python";
      text: string;
    }[]
  ];
}
/**
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "MethodologyAlternative".
 */
export interface MethodologyAlternative {
  id: string;
  label: string;
  description: string;
  applicability: "applicable" | "needs_fact" | "not_applicable";
  reason: string;
  effect?: GraphEffect;
}
/**
 * Immutable resolver output. It explains alternatives and previews typed effects; it does not mutate a graph.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "DecisionProposal".
 */
export interface DecisionProposal {
  schema_version: "sprisk.decision_proposal/v1";
  id: MethodologyProposalId;
  rule: CheckRef;
  question_version_id: QuestionVersionId;
  pipeline_version_id: PipelineVersionId;
  subject_node_id: NodeId;
  evidence: MethodologyEvidence[];
  /**
   * @minItems 1
   */
  alternatives: [MethodologyAlternative, ...MethodologyAlternative[]];
  recommended_alternative_id?: string;
  /**
   * The alternatives a shortlist rule puts forward to compare (ADR-0044).
   */
  shortlist?: string[];
  fingerprint: ContentHash;
  created_at: Timestamp;
}
/**
 * Every applicable rule's status on one pipeline version, in decision order (ADR-0059). Read-only: it stores nothing.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "MethodologyReview".
 */
export interface MethodologyReview {
  schema_version: "sprisk.methodology_review/v1";
  pipeline_version_id: PipelineVersionId;
  items: MethodologyReviewItem[];
  /**
   * Indexes into items of the open items with nothing open before them.
   */
  next: number[];
}
/**
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "MethodologyReviewItem".
 */
export interface MethodologyReviewItem {
  rule: CheckRef;
  decides: string;
  stage: MethodologyStage;
  subject_node_id?: NodeId;
  status: MethodologyReviewStatus;
  reason: string;
  recommended_alternative_id?: string;
  /**
   * Stages in decision order (ADR-0059): the split comes before cleaning, since cleaning rules measure train rows.
   */
  reopens?: "question" | "data" | "split" | "cleaning" | "features" | "models" | "evaluation" | "reporting";
}
/**
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "ApplyMethodologyDecision".
 */
export interface ApplyMethodologyDecision {
  alternative_id: string;
  reason?: string;
  idempotency_key: string;
}
/**
 * A rule's alternative atomically applied to a new pipeline version.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "MethodologyDecisionByRule".
 */
export interface MethodologyDecisionByRule {
  schema_version: "sprisk.methodology_decision/v1";
  id: MethodologyDecisionId;
  proposal_id: MethodologyProposalId;
  rule: CheckRef;
  question_version_id: QuestionVersionId;
  base_pipeline_version_id: PipelineVersionId;
  pipeline_version_id: PipelineVersionId;
  subject_node_id: NodeId;
  alternative_id: string;
  reason?: string;
  /**
   * The SelectionDecision this choice followed or overrode (ADR-0050). Absent when no comparison had decided.
   */
  selection_id?: string;
  /**
   * The guardrails the chosen alternative failed in the SelectionDecision this choice overrode, with its values (ADR-0052). Absent when it failed none.
   */
  missed_guardrails?: GuardrailResult[];
  /**
   * Earlier versions applied from the same proposal whose runs had already scored the test rows (arch doc §11). Absent when none had.
   */
  test_rows_seen_by?: PipelineVersionId[];
  created_at: Timestamp;
}
/**
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "GuardrailResult".
 */
export interface GuardrailResult {
  label: string;
  at_least: number;
  /**
   * Mean over the outer folds of the recall of `label`.
   */
  mean: number;
  /**
   * Its standard error, corrected for folds that share train rows as for the scores.
   */
  corrected_se: number;
  /**
   * Whether `mean` is at least `at_least`.
   */
  passed: boolean;
}
/**
 * A method's option taken through the same Apply as a rule's (ADR-0064): keyed per walk round, refused on a changed base, and cited by every step it changed.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "MethodologyDecisionByMethod".
 */
export interface MethodologyDecisionByMethod {
  schema_version: "sprisk.methodology_decision/v1";
  id: MethodologyDecisionId;
  method: MethodRef;
  decides: string;
  option: MethodOptionId;
  assurance: MethodAssurance;
  reason: string;
  question_version_id: QuestionVersionId;
  base_pipeline_version_id: PipelineVersionId;
  /**
   * The version the option made. Absent when it changed no step.
   */
  pipeline_version_id?: string;
  /**
   * The patch the option applied, in order. Absent: it changed no step.
   */
  effects?: GraphEffect[];
  /**
   * The bindings the option made. Absent: none.
   */
  bindings?: Binding[];
  /**
   * The verifications the option promises, by name. Absent: none.
   */
  promises?: VerificationName[];
  /**
   * What the method read, whether it chose or a person answered. Absent: it read none.
   */
  evidence?: UsedEvidence[];
  created_at: Timestamp;
}
/**
 * Evidence a method read: its kind, the step that measured it and the fields it saw (ADR-0064). Recorded with the decision, whether the method chose or a person answered its question, so a person can see what it rested on.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "UsedEvidence".
 */
export interface UsedEvidence {
  kind: EvidenceKind;
  /**
   * Node name, unique within a pipeline version.
   */
  step: string;
  /**
   * The fields as the method saw them.
   */
  fields: {
    [k: string]: unknown;
  };
}
/**
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "AppliedMethodologyDecision".
 */
export interface AppliedMethodologyDecision {
  decision: MethodologyDecision;
  pipeline: PipelineVersion;
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
   * Exact immutable question-ledger revision this flow answers. Absent only for legacy or not-yet-scoped flows.
   */
  question_version_id?: string;
  /**
   * Version this one was derived from. Absent for the first version.
   */
  parent_id?: string;
  /**
   * The shortlist proposal whose models this version cross-validates (ADR-0046). A comparison is a side version, not an edit: it has no parent_id, so the proposal stays applicable. Absent on every other version.
   */
  compares?: string;
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
  /**
   * Decision that produced this node state. Absent for a hand-authored node.
   */
  methodology_decision_id?: string;
  code?: NodeCode;
  from_notebook?: NodeSource;
  /**
   * The kind of step, as people read it: Box plot, Train/test split (ADR-0055). The step's id says what it is about. Omitted: its operator's name.
   */
  title?: string;
  /**
   * The stage notebook this step's cell is in (ADR-0055). Omitted: the stage its operator implies.
   */
  stage?: "load" | "split" | "explore" | "clean" | "model" | "evaluate";
  notes?: NodeNotes;
  /**
   * The variable each output port goes by in the notebook, by port (ADR-0055). Omitted: the port names.
   */
  names?: {
    [k: string]: VariableName;
  };
}
/**
 * This step's own code in this version, replacing its operator's implementation (ADR-0028). Omitted: the operator's code runs.
 */
export interface NodeCode {
  /**
   * Python module source.
   */
  source: string;
  /**
   * The function in source that is the step.
   */
  function: string;
}
/**
 * The notebook cells this node was created from (ADR-0036). Omitted: not made from a notebook.
 */
export interface NodeSource {
  notebook_version_id: NotebookVersionId;
  /**
   * The notebook these cells belong to, so saving it again rebuilds its steps (ADR-0037). Absent on nodes made before.
   */
  notebook_id?: string;
  cells: NotebookCellId[];
}
/**
 * Markdown cells shown with this step's cell (ADR-0055). Omitted: none.
 */
export interface NodeNotes {
  /**
   * Markdown cells above the step's cell, in order.
   */
  before?: string[];
  /**
   * Markdown cells below it; only the last step of a stage has them.
   */
  after?: string[];
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
 * How Sprisk is choosing one step of a flow's model pipeline (ADR-0050): a model step's shortlist proposal, or a preparation step's proposal; the version that cross-validates it; and that version's latest run. Its select step's output is the SelectionDecision.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "ModelSelection".
 */
export interface ModelSelection {
  proposal: DecisionProposal;
  comparison: PipelineVersion;
  run: Run;
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
  /**
   * The run whose unchanged results this run reused (ADR-0026). Omitted when it ran from the start.
   */
  reuse_run_id?: string;
  /**
   * Node name, unique within a pipeline version.
   */
  run_from_node_id?: string;
  created_at: Timestamp;
  /**
   * UTC, whole seconds, Z suffix. One canonical form so every language round-trips it unchanged. Pattern only: typify ignores pattern when format is set.
   */
  finished_at?: string;
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
  question_version_id?: QuestionVersionId;
  methodology_decision_id?: MethodologyDecisionId;
  check: CheckRef;
  phase?: MethodologyPhase;
  coverage?: MethodologyCoverage;
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
 * One saved state of a notebook (ADR-0036): its ordered code and Markdown cells. Immutable; each save is a new version. Outputs are not saved: they belong to the session.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "NotebookVersion".
 */
export interface NotebookVersion {
  schema_version: "sprisk.notebook_version/v1";
  id: NotebookVersionId;
  notebook_id: NotebookId;
  project_id: ProjectId;
  /**
   * Version this one was saved over. Absent for a notebook's first version.
   */
  parent_id?: string;
  /**
   * The flow version this notebook was made in or last synced into (ADR-0037). The notebook belongs to that flow and its later versions. Absent: not in a flow yet.
   */
  pipeline_version_id?: string;
  title: string;
  cells: NotebookCell[];
  created_at: Timestamp;
  /**
   * Present and true: the notebook was deleted in this version (ADR-0041). It is no longer listed; its history stays readable. Absent otherwise.
   */
  removed?: boolean;
}
/**
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "NotebookCell".
 */
export interface NotebookCell {
  id: NotebookCellId;
  kind: "code" | "markdown";
  source: string;
}
/**
 * Run one cell's code in the notebook's session kernel (ADR-0036). Body of POST /notebooks/{id}/execute.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "NotebookExecute".
 */
export interface NotebookExecute {
  cell_id: NotebookCellId;
  code: string;
}
/**
 * What one cell did in the session kernel: its execution count, what it printed and showed (capped, as a code step's display), and its error. Scratch, not provenance (ADR-0036).
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "NotebookExecution".
 */
export interface NotebookExecution {
  status: "ok" | "error" | "interrupted" | "timed_out";
  /**
   * The kernel's count for this execution. Absent when the cell never got one (timed out before it started).
   */
  execution_count?: number;
  outputs: DisplayItem[];
  error?: NotebookError;
  /**
   * Present and true when the kernel restarted before or during this cell (memory cap, crash, stuck interrupt): every variable is gone. Absent otherwise.
   */
  kernel_restarted?: boolean;
}
/**
 * Present when status is error or interrupted.
 */
export interface NotebookError {
  name: string;
  message: string;
  /**
   * Plain text lines, colour codes removed.
   */
  traceback: string[];
}
/**
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "ExecutionRunning".
 */
export interface ExecutionRunning {
  kind: "running";
  /**
   * The kernel's count for this execution, once it has one.
   */
  execution_count?: number;
  /**
   * Every output so far, not only the new ones, capped as in the result.
   */
  outputs: DisplayItem[];
}
/**
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "ExecutionDone".
 */
export interface ExecutionDone {
  kind: "done";
  execution: NotebookExecution;
}
/**
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "ExecutionFailed".
 */
export interface ExecutionFailed {
  kind: "failed";
  problem: Problem;
}
/**
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "NotebookError".
 */
export interface NotebookError1 {
  name: string;
  message: string;
  /**
   * Plain text lines, colour codes removed.
   */
  traceback: string[];
}
/**
 * Which names the session kernel holds and whether each is a table, so Create node can refuse an output that cannot cross a boundary (ADR-0036).
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "NotebookVariables".
 */
export interface NotebookVariables {
  variables: NotebookVariable[];
}
/**
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "NotebookVariable".
 */
export interface NotebookVariable {
  name: PortName;
  defined: boolean;
  /**
   * Module and class, e.g. pandas.DataFrame. Absent when not defined.
   */
  type?: string;
  /**
   * A pandas or polars DataFrame: the one kind of value that crosses a node boundary today.
   */
  table: boolean;
}
/**
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "KernelExecute".
 */
export interface KernelExecute {
  op: "execute";
  code: string;
}
/**
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "KernelInterrupt".
 */
export interface KernelInterrupt {
  op: "interrupt";
}
/**
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "KernelVariables".
 */
export interface KernelVariables {
  op: "variables";
  names: PortName[];
}
/**
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "KernelShutdown".
 */
export interface KernelShutdown {
  op: "shutdown";
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
  model?: OperatorModel;
  /**
   * The step's name for people: the standard term for what it does (Group split, Imputation). Shown by the UI, CLI and notebooks; the description explains it in plain words. Absent: the operator's name stands in.
   */
  title?: string;
  description?: string;
  /**
   * Python `module:function` the worker calls.
   */
  entrypoint: string;
  /**
   * Python `module:function` that writes this step as plain Python for a notebook cell, with its settings and names filled in (ADR-0055). A test runs that code against the step on fixtures. Absent: the step has no plain code yet.
   */
  notebook_code?: string;
  /**
   * True for a step that reads train and test on ports of those names, fits on train only and writes each from its own rows. Such a step keeps train rows apart, and is refit on each fold when models are compared (ADR-0050). Absent: it may mix rows.
   */
  fits_on_train?: boolean;
  /**
   * The one job a step does in a flow, so methods place and replace steps by role, and the engine builds a step of a role from its default operator, never by name (ADR-0064). score: scores a model on rows. score_shares: compares the class shares of train and test at the final score. cross_validate: scores a candidate on folds. select: chooses among compared candidates. row_filter: only drops rows.
   */
  role?: "source" | "split" | "model" | "score" | "score_shares" | "cross_validate" | "select" | "row_filter";
  /**
   * True for the operator the engine uses when it builds a step of this role (ADR-0064). At most one per role. Absent: not a default.
   */
  role_default?: boolean;
  /**
   * Set on a split: how its folds are made when models are compared. Absent: a flow with this split cannot be compared.
   */
  folds?: "plain" | "group" | "time";
  attach?: OperatorAttach1;
  /**
   * Which rows the step reads. Absent: whatever its inputs carry.
   */
  scope?: "all" | "train";
  /**
   * Params a project's binding fills: param name to concept (ADR-0063). Absent: none.
   */
  concepts?: {
    [k: string]: ConceptId;
  };
  /**
   * The evidence the step measures, by kind, with its fields (ADR-0063). The step writes it as one EvidenceSet to its output named evidence, and needs an attach. Absent: none.
   */
  produces?: {
    [k: string]: EvidenceProduced;
  };
  inputs: InputPort[];
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
 * Set on every operator that fits a model on rows, for preparation rules: how its fit reacts to its inputs. A model fits only the model; Clean steps prepare its inputs (ADR-0056).
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "OperatorModel".
 */
export interface OperatorModel {
  /**
   * Left out for a model that ignores its features, such as a dummy baseline.
   */
  family?: "tree_ensemble" | "linear" | "distance_based" | "density_based";
  /**
   * The supervised tasks the model fits, so a shortlist rule can offer it (ADR-0044).
   */
  tasks?: TaskType[];
  /**
   * How flexible the model is, for the one-SE rule (ADR-0050): of the models within one standard error of the best, the one with the lowest complexity is recommended. 0 ignores its features; linear models are 1; tree ensembles 2. Set on every supervised model.
   */
  complexity?: number;
  /**
   * Python `module:function` returning the model unfitted, given its params except target, features and costs, so cross-validation can refit it per fold (ADR-0044, ADR-0046). Set on every supervised model.
   */
  estimator?: string;
  /**
   * The settings a study may tune, in this order, each with the values it tries (ADR-0052). Left out for a model with nothing to tune.
   */
  search?: SearchSetting[];
}
/**
 * One setting a study may tune: a params property of the model, and the finite list of values it tries. The registry checks each value against the property's schema.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "SearchSetting".
 */
export interface SearchSetting {
  name: string;
  values: unknown[];
}
/**
 * Set on an evidence producer: where the engine adds it (ADR-0063).
 */
export interface OperatorAttach1 {
  role: OperatorRole;
  side: "input" | "output";
}
/**
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "InputPort".
 */
export interface InputPort {
  name: PortName;
  kind: PortKind;
  description?: string;
  /**
   * An input the step may run without (ADR-0058): left unconnected, the step gets nothing for it. Only a matrix input may be optional today; the registry refuses any other.
   */
  optional?: boolean;
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
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "NodeNotes".
 */
export interface NodeNotes1 {
  /**
   * Markdown cells above the step's cell, in order.
   */
  before?: string[];
  /**
   * Markdown cells below it; only the last step of a stage has them.
   */
  after?: string[];
}
/**
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "NodeSource".
 */
export interface NodeSource1 {
  notebook_version_id: NotebookVersionId;
  /**
   * The notebook these cells belong to, so saving it again rebuilds its steps (ADR-0037). Absent on nodes made before.
   */
  notebook_id?: string;
  cells: NotebookCellId[];
}
/**
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "NodeCode".
 */
export interface NodeCode1 {
  /**
   * Python module source.
   */
  source: string;
  /**
   * The function in source that is the step.
   */
  function: string;
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
  entity_column?: Fact2;
  time_column?: Fact;
  prediction_horizon?: Fact3;
  assumptions: Fact[];
  unknowns: Unknown[];
  acceptance_criteria: Fact[];
  costs?: CostsFact;
  interpretability?: InterpretabilityFact;
  success_bar?: SuccessBarFact;
  /**
   * Which column means each concept the packs ask for, in this project (ADR-0063). One binding per concept. Absent: none stated.
   */
  bindings?: Binding[];
  /**
   * A person's answers to the methods' asks, one per decision key (ADR-0063 amendment). Absent: none given.
   */
  answers?: DecisionAnswer[];
  created_at: Timestamp;
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
 * Column whose values identify the unit or group that must not cross an entity-aware split.
 */
export interface Fact2 {
  value: string;
  origin: Origin;
}
/**
 * How far after prediction time the outcome is observed, preferably an ISO-8601 duration such as P30D.
 */
export interface Fact3 {
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
 * What each wrong prediction costs, for a two-class classification question (ADR-0053). Only a person can state it. Absent: unknown, so both mistakes are treated as costing the same.
 */
export interface CostsFact {
  value: Costs;
  /**
   * Costs are never inferred or measured.
   */
  origin: "explicit" | "confirmed";
}
/**
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "Costs".
 */
export interface Costs {
  /**
   * The class whose miss costs, as text.
   */
  positive: string;
  /**
   * Cost of predicting another class for a `positive` row. Positive; the API refuses others.
   */
  false_negative: number;
  /**
   * Cost of predicting `positive` for another row. Positive; the API refuses others. A correct prediction costs nothing.
   */
  false_positive: number;
}
/**
 * How far a person must follow each prediction, a hard constraint (ref-v3 0.4). high: only models a person can read, such as linear ones. Only a person can state it. Absent: not stated.
 */
export interface InterpretabilityFact {
  value: "high" | "medium" | "low";
  /**
   * A constraint is never inferred or measured.
   */
  origin: "explicit" | "confirmed";
}
/**
 * The cross-validated score that counts as good enough, in a metric models are compared by (ADR-0059). Only a person can state it. Absent: not stated; the text acceptance criteria hold everything else.
 */
export interface SuccessBarFact {
  value: SuccessBar;
  /**
   * A bar is never inferred or measured: one set from the scores always looks met.
   */
  origin: "explicit" | "confirmed";
}
/**
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "SuccessBar".
 */
export interface SuccessBar {
  metric: SelectionMetric;
  /**
   * At least this for balanced_accuracy, at most this for expected_cost and rmse. The API refuses a balanced accuracy outside 0 to 1 and a negative cost or error.
   */
  score: number;
}
/**
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "SuccessBarFact".
 */
export interface SuccessBarFact1 {
  value: SuccessBar;
  /**
   * A bar is never inferred or measured: one set from the scores always looks met.
   */
  origin: "explicit" | "confirmed";
}
/**
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "InterpretabilityFact".
 */
export interface InterpretabilityFact1 {
  value: "high" | "medium" | "low";
  /**
   * A constraint is never inferred or measured.
   */
  origin: "explicit" | "confirmed";
}
/**
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "CostsFact".
 */
export interface CostsFact1 {
  value: Costs;
  /**
   * Costs are never inferred or measured.
   */
  origin: "explicit" | "confirmed";
}
/**
 * What a completed walk found, built from its records, never written by a model (ADR-0064). Immutable; one per completed walk. Its answer is the model's score on the test rows, scored once, against the success bar and the baseline.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "Report".
 */
export interface Report {
  schema_version: "sprisk.report/v1";
  id: ReportId;
  walk_id: WalkId;
  question_version_id: QuestionVersionId;
  /**
   * The question's objective, as a person stated it.
   */
  question: string;
  answer: ReportClaim;
  /**
   * One per decision the walk made and per promise it checked, in trail order.
   */
  claims: ReportClaim[];
  /**
   * What the answer does not show.
   */
  limitations: string[];
  created_at: Timestamp;
}
/**
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "ReportClaim".
 */
export interface ReportClaim {
  statement: string;
  /**
   * The records the statement rests on. The engine builds every claim on at least one.
   */
  evidence: ReportEvidence[];
}
/**
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "WalkStepRef".
 */
export interface WalkStepRef {
  walk_id: WalkId;
  round: number;
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
 * Which compared alternative cross-validation chose, and why (arch doc §11, ADR-0044, ADR-0050): a shortlisted model, or one way of doing a preparation step. The output of a select step: immutable, like every artifact. An alternative wins only by beating the baseline on the same folds; a reference baseline wins when none does.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "SelectionDecision".
 */
export interface SelectionDecision {
  schema_version: "sprisk.selection_decision/v1";
  metric: SelectionMetric;
  /**
   * Number of cross-validation folds every candidate was scored on.
   */
  folds: number;
  /**
   * How many times the rows were shuffled into folds (ADR-0050). Absent: once, as before repeated folds.
   */
  repeats?: number;
  /**
   * Seed that shuffled the rows into folds.
   */
  seed: number;
  /**
   * The candidate every other must beat. As a floor, a model that ignores its features; as a reference, the rule's recommended preparation.
   */
  baseline: string;
  /**
   * Absent: floor, as decided before ADR-0050 compared preparation.
   */
  baseline_role?: "floor" | "reference";
  candidates: CandidateResult[];
  /**
   * The chosen candidate. Absent: no model beats a floor baseline. A reference baseline is the winner when no alternative beats it.
   */
  winner?: string;
  reason: string;
  /**
   * Alternatives the comparison did not score, each with why (ADR-0050). Absent: decided before ADR-0050 recorded them.
   */
  not_compared?: NotCompared[];
  /**
   * What the comparison did not cover.
   */
  limitations: string[];
  /**
   * Constraints a candidate had to meet to win, declared with the study (EXP-02, ADR-0052). Absent: none were declared.
   */
  guardrails?: Guardrail[];
  /**
   * With costs: the share of the costed class in the train rows. Expected cost and each tuned cut-off hold at this share only (ADR-0053).
   */
  positive_share?: number;
  /**
   * Earlier comparisons of the same version and step, started on the same folds before this one, whether or not they finished (ADR-0052). Absent: none.
   */
  earlier_looks?: PipelineVersionId[];
}
/**
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "CandidateResult".
 */
export interface CandidateResult {
  /**
   * The compared alternative.
   */
  id: string;
  /**
   * The metric on each fold's validation rows, in fold order, repeat after repeat.
   */
  fold_scores: number[];
  mean: number;
  /**
   * Standard deviation of the fold scores.
   */
  spread: number;
  versus_baseline?: BaselineComparison;
  search?: CandidateSearch;
  /**
   * Each declared guardrail, in declared order, as this candidate met it. Absent: none were declared.
   */
  guardrails?: GuardrailResult[];
}
/**
 * Absent for the baseline itself.
 */
export interface BaselineComparison {
  /**
   * Mean fold-by-fold improvement over the baseline on the same folds; positive is better for either metric.
   */
  mean_difference: number;
  /**
   * Standard error of that mean, corrected for folds that share train rows: the correction of Nadeau & Bengio (2003), applied to k-fold as in Bouckaert & Frank (2004).
   */
  corrected_se: number;
  /**
   * One-sided p of the corrected repeated k-fold t-test that the alternative is no better than the baseline (Bouckaert & Frank 2004). Absent: decided by the one-SE screen, before ADR-0050's test.
   */
  p_value?: number;
  /**
   * With p_value: whether the test rejects at α = 0.05 after a Holm adjustment over the other alternatives. Without: whether mean_difference is larger than one corrected_se, a screening rule.
   */
  beats_baseline: boolean;
}
/**
 * How its settings were tuned (ADR-0052). Absent: it ran at the flow's settings.
 */
export interface CandidateSearch {
  trials: SearchedTrial[];
  settings: Params;
}
/**
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "SearchedTrial".
 */
export interface SearchedTrial {
  id: string;
  settings: Params;
  /**
   * Mean inner score over the outer folds: what the search saw. Not a performance estimate.
   */
  inner_mean: number;
  /**
   * How many outer folds chose this trial.
   */
  chosen_in: number;
}
/**
 * An alternative the comparison could not score on the folds, and why (ADR-0050).
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "NotCompared".
 */
export interface NotCompared {
  /**
   * The proposal's alternative.
   */
  id: string;
  /**
   * Why it was not scored on the folds.
   */
  reason: string;
}
/**
 * A constraint a candidate must meet to win (EXP-02). recall: the mean over outer folds of the recall of `label` must be at least `at_least`.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "Guardrail".
 */
export interface Guardrail {
  metric: "recall";
  /**
   * The target value, as text.
   */
  label: string;
  /**
   * Between 0 and 1.
   */
  at_least: number;
}
/**
 * A tuned candidate: on each outer fold, the trial with the best inner score on that fold's training rows gave the fold score, so the fold scores describe the tuning, not one setting. `settings` is the trial with the best inner score on all train rows: the one to apply.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "CandidateSearch".
 */
export interface CandidateSearch1 {
  trials: SearchedTrial[];
  settings: Params;
}
/**
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "BaselineComparison".
 */
export interface BaselineComparison1 {
  /**
   * Mean fold-by-fold improvement over the baseline on the same folds; positive is better for either metric.
   */
  mean_difference: number;
  /**
   * Standard error of that mean, corrected for folds that share train rows: the correction of Nadeau & Bengio (2003), applied to k-fold as in Bouckaert & Frank (2004).
   */
  corrected_se: number;
  /**
   * One-sided p of the corrected repeated k-fold t-test that the alternative is no better than the baseline (Bouckaert & Frank 2004). Absent: decided by the one-SE screen, before ADR-0050's test.
   */
  p_value?: number;
  /**
   * With p_value: whether the test rejects at α = 0.05 after a Holm adjustment over the other alternatives. Without: whether mean_difference is larger than one corrected_se, a screening rule.
   */
  beats_baseline: boolean;
}
/**
 * A comparison of a flow's model step with search trials and a budget (arch doc §11, ADR-0052). Its trials are the cross-validate steps of its comparison version; status is the transactionally maintained current state, like a run's.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "Study".
 */
export interface Study {
  schema_version: "sprisk.study/v1";
  id: StudyId;
  project_id: ProjectId;
  /**
   * The flow version whose model step is studied.
   */
  pipeline_version_id: string;
  /**
   * Node name, unique within a pipeline version.
   */
  node_id: string;
  /**
   * The study's own shortlist proposal; its comparison is the study's.
   */
  proposal_id: string;
  /**
   * The comparison version holding the trials and the select step.
   */
  comparison_id: string;
  /**
   * The comparison's run.
   */
  run_id: string;
  strategy: StudyStrategy;
  /**
   * Shuffles the grid for random search.
   */
  seed: number;
  /**
   * Most trials the study may hold; checked when it is built.
   */
  max_trials: number;
  /**
   * Longest the study's run may take, counted from its start.
   */
  max_wall_seconds: number;
  /**
   * Declared when the study is created, before this study's scores exist (EXP-02). Earlier comparisons of the same step may have been seen; the decision lists them (ADR-0052).
   */
  guardrails: Guardrail[];
  status: StudyStatus;
  /**
   * UTC, whole seconds, Z suffix. One canonical form so every language round-trips it unchanged. Pattern only: typify ignores pattern when format is set.
   */
  deadline?: string;
  created_at: Timestamp;
  /**
   * UTC, whole seconds, Z suffix. One canonical form so every language round-trips it unchanged. Pattern only: typify ignores pattern when format is set.
   */
  finished_at?: string;
}
/**
 * Request to study a model step (ADR-0052). Settings and their values come from model manifests, never from here. Replaying the key with the same body returns the same study; with another body, 409.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "CreateStudy".
 */
export interface CreateStudy {
  idempotency_key: string;
  strategy: StudyStrategy;
  seed: number;
  max_trials: number;
  max_wall_seconds: number;
  guardrails: Guardrail[];
}
/**
 * One cross-validate step of a study: one candidate at one set of settings (TrialSpec, arch doc §11). Built from the comparison version and its run, never stored: its attempts are the run's attempts of that step (TrialAttempt), and its scores table is the TrialResult.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "Trial".
 */
export interface Trial {
  schema_version: "sprisk.trial/v1";
  study_id: StudyId;
  /**
   * Node name, unique within a pipeline version.
   */
  node_id: string;
  /**
   * The shortlist alternative this trial scores.
   */
  candidate: string;
  /**
   * Pinned operator: dotted name @ semver, e.g. sprisk.eval.binary_classification@1.0.0.
   */
  operator: string;
  settings: Params6;
  state: TrialState;
  /**
   * Its attempts, oldest first.
   */
  attempts: AttemptId[];
  /**
   * Its per-fold scores table. Absent until it succeeds.
   */
  scores?: string;
}
/**
 * Operator parameters. Validated against the operator's params_schema by the compiler, not here.
 */
export interface Params6 {
  [k: string]: unknown;
}
/**
 * A study with its trials, in study order, and its run.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "StudyDetail".
 */
export interface StudyDetail {
  study: Study;
  trials: Trial[];
  run: Run;
}
/**
 * Request for the engine to build, run and judge a flow from a question and its data (ADR-0060). Replaying the key with the same body returns the same walk; with another body, 409.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "CreateWalk".
 */
export interface CreateWalk {
  idempotency_key: string;
  project_id: ProjectId;
  question_version_id: QuestionVersionId;
  sources: WalkSources;
  /**
   * Most actions (applies, runs, comparisons) the walk may take.
   */
  max_actions: number;
  /**
   * Longest the walk may take, counted from its creation.
   */
  max_wall_seconds: number;
}
/**
 * The engine walking the methodology map for one question (ADR-0060). The one mutable control record: its status, head and stop change as it walks. What it did is its WalkSteps, which never change.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "Walk".
 */
export interface Walk {
  schema_version: "sprisk.walk/v1";
  id: WalkId;
  project_id: ProjectId;
  question_version_id: QuestionVersionId;
  sources: WalkSources;
  /**
   * Each source's SHA-256 when the walk began, in the order of `sources`. Every round checks them: a source that changed stops the walk. Absent on walks made before they were recorded, and on one that stopped before building anything.
   */
  source_hashes?: ContentHash[];
  max_actions: number;
  max_wall_seconds: number;
  status: WalkStatus;
  /**
   * The latest version the walk made. Absent when it stopped before building one.
   */
  head_pipeline_version_id?: string;
  stop?: WalkStop;
  created_at: Timestamp;
  /**
   * UTC, whole seconds, Z suffix. One canonical form so every language round-trips it unchanged. Pattern only: typify ignores pattern when format is set.
   */
  finished_at?: string;
}
/**
 * Why it stopped. Present once stopped.
 */
export interface WalkStop {
  reason: WalkStopReason;
  /**
   * What is open, for a person to read. Never parsed.
   */
  detail: string;
  /**
   * Every question the walk's look found open, as one list (ADR-0063 amendment). Absent: the walk stopped for another reason.
   */
  asks?: WalkAsk[];
}
/**
 * One open question. A method's ask names its method and options: a person answers it with one option, on the question. Any other names the question fact to state, as its key.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "WalkAsk".
 */
export interface WalkAsk {
  /**
   * <area>.<decision>, the key other methods read a decision by.
   */
  decides: string;
  /**
   * The question, for a person.
   */
  question: string;
  /**
   * methodology.<pack>.<method>@<semver>
   */
  method?: string;
  /**
   * The option the method would take, once a person confirms it.
   */
  option?: string;
  /**
   * Every option of the method, for the person to pick from. Present exactly when method is.
   */
  options?: WalkAskOption[];
}
/**
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "WalkAskOption".
 */
export interface WalkAskOption {
  id: MethodOptionId;
  label: string;
}
/**
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "WalkStop".
 */
export interface WalkStop1 {
  reason: WalkStopReason;
  /**
   * What is open, for a person to read. Never parsed.
   */
  detail: string;
  /**
   * Every question the walk's look found open, as one list (ADR-0063 amendment). Absent: the walk stopped for another reason.
   */
  asks?: WalkAsk[];
}
/**
 * One thing the engine did, and why (ADR-0060). Immutable; a walk's trail is its steps in round order.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "WalkStep".
 */
export interface WalkStep {
  schema_version: "sprisk.walk_step/v1";
  walk_id: WalkId;
  /**
   * Its place in the trail, from 0.
   */
  round: number;
  action: WalkAction;
  /**
   * The version it reviewed. Absent for build.
   */
  pipeline_version_id?: string;
  /**
   * Pinned rule: <pack>.<rule>@<semver>.
   */
  rule?: string;
  /**
   * What the rule decides. Absent for build, run and stop.
   */
  decides?: string;
  /**
   * Node name, unique within a pipeline version.
   */
  subject_node_id?: string;
  /**
   * The alternative it applied.
   */
  alternative_id?: string;
  /**
   * The decision an apply recorded.
   */
  methodology_decision_id?: string;
  /**
   * The version a build, apply, measure or decide made. Absent for a decide whose option changes no step.
   */
  made_pipeline_version_id?: string;
  /**
   * The patch a measure or decide step applied, in order (ADR-0063). Absent for every other action.
   */
  effects?: GraphEffect[];
  /**
   * methodology.<pack>.<method>@<semver>
   */
  method?: string;
  /**
   * The option a decide step took. A decide step always has method, decides, option and assurance.
   */
  option?: string;
  /**
   * How a method's option was taken: confirmed, a person answered the method's ask; rule, the method chose it unasked.
   */
  assurance?: "confirmed" | "rule";
  /**
   * The bindings a decide step's option made. Absent: none.
   */
  bindings?: Binding[];
  /**
   * The verifications a decide step's option promises, by name. Absent: none.
   */
  promises?: VerificationName[];
  /**
   * What a decide step's method read, whether it chose or a person answered. Absent: it read no evidence.
   */
  evidence?: UsedEvidence[];
  /**
   * What a verify step found, one item per promise the walk's decisions made. Absent for every other action.
   */
  verifications?: PromiseCheck[];
  /**
   * The run a run step started, or the run whose evidence a verify step read.
   */
  run_id?: string;
  /**
   * Why, from the review item it acted on.
   */
  reason: string;
  created_at: Timestamp;
}
/**
 * One promise checked on the evidence a run measured (ADR-0063).
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "PromiseCheck".
 */
export interface PromiseCheck {
  decides: string;
  method: MethodRef;
  verification: VerificationName;
  /**
   * What holds when it passes, from method.yaml.
   */
  promise: string;
  /**
   * Node name, unique within a pipeline version.
   */
  step?: string;
  result: PromiseResult;
  /**
   * What the evidence showed, or why nothing measured it.
   */
  detail: string;
}
/**
 * What decided a flow version, for people (ADR-0063 slice 5): the decisions of the walk that made the version or its nearest ancestor, each with the steps it shaped and the status of its promises on this version. Read only; worked out from the walk's steps.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "FlowDecisions".
 */
export interface FlowDecisions {
  schema_version: "sprisk.flow_decisions/v1";
  pipeline_version_id: PipelineVersionId;
  /**
   * The walk that made the version or its nearest ancestor. Absent: no walk did, so nothing decided it.
   */
  walk_id?: string;
  decisions: FlowDecision[];
}
/**
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "FlowDecision".
 */
export interface FlowDecision {
  decides: string;
  method: MethodRef;
  /**
   * The method's activity: one stage card, one notebook section.
   */
  activity: string;
  /**
   * The question the method answers.
   */
  question: string;
  option: MethodOptionId;
  /**
   * The option, for people.
   */
  label: string;
  /**
   * Why it was taken, from the decide step.
   */
  reason: string;
  assurance: MethodAssurance;
  /**
   * The steps it shaped or rested on: those its patch changed, those its bindings read, those that measured its promises, and those that measured the evidence it read.
   */
  steps: NodeId[];
  /**
   * The bindings it made. Absent: none.
   */
  bindings?: Binding[];
  /**
   * What the method read, with the step that measured it. Absent: none.
   */
  evidence?: UsedEvidence[];
  promises: PromiseStatus[];
}
/**
 * One promise's standing on the version asked about.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "PromiseStatus".
 */
export interface PromiseStatus {
  verification: VerificationName;
  promise: string;
  status: PromiseStanding;
  detail: string;
  /**
   * Node name, unique within a pipeline version.
   */
  step?: string;
  /**
   * pass, fail, inconclusive: what verify_<name>() found. not_evaluated: no step measured the evidence it needs. Stale is never recorded: it is worked out against a newer version.
   */
  last_result?: "pass" | "fail" | "inconclusive" | "not_evaluated";
}
/**
 * A walk and its trail, oldest step first. A walk takes at most max_actions steps, so the trail is bounded.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "WalkDetail".
 */
export interface WalkDetail {
  walk: Walk;
  steps: WalkStep[];
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
  code?: NodeCode2;
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
 * The step's own code (ADR-0028): run this function instead of the operator's.
 */
export interface NodeCode2 {
  /**
   * Python module source.
   */
  source: string;
  /**
   * The function in source that is the step.
   */
  function: string;
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
