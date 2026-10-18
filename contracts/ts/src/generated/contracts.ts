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
 * Stable within a notebook across versions, as in Jupyter's nbformat 4.5.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "NotebookCellId".
 */
export type NotebookCellId = string;
/**
 * One line of a cell's execution as it happens (ADR-0041), from the session host to Rust and, when asked with Accept: application/x-ndjson, from POST /notebooks/{id}/execute to the browser. Tagged by `kind`: `running` lines carry every output so far; the last line is `done`.
 *
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "NotebookExecutionEvent".
 */
export type NotebookExecutionEvent = ExecutionRunning | ExecutionDone;
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
  /**
   * Reuse this run's results for every step whose definition is unchanged; run the rest (ADR-0026). Omitted: run from the start.
   */
  reuse_run_id?: string;
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
 * A descriptive profile of one table (GET /artifacts/{id}/profile, ADR-0038), computed by Python. Bounded: at most the first 200 columns and 1,000,000 rows, histograms of at most 20 bars, a missing-value map of at most 40 row bands, correlation of at most 30 columns. For people only: the AI planner and methodology checks never read it, since it covers held-out rows.
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
  code?: NodeCode;
  from_notebook?: NodeSource;
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
 * This interface was referenced by `Bundle`'s JSON-Schema
 * via the `definition` "Edge".
 */
export interface Edge {
  from: PortRef;
  to: PortRef;
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
  /**
   * The run whose unchanged results this run reused (ADR-0026). Omitted when it ran from the start.
   */
  reuse_run_id?: string;
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
