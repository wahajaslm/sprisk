# Generated from contracts/schemas. Do not edit.

from __future__ import annotations

from typing import Annotated, Any, Literal
from pydantic import ConfigDict, Field, RootModel
from sprisk_contracts.base import StrictModel
from enum import StrEnum


class Bundle(RootModel[Any]):
    root: Annotated[Any, Field(title="Bundle")]


class TableColumn(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    name: str
    data_type: Annotated[str, Field(description="Arrow data type name, for display only.")]


class MissingItem(RootModel[int]):
    root: Annotated[int, Field(ge=0)]


class TableRow(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    values: list[str]
    missing: Annotated[
        list[MissingItem],
        Field(description="Indexes of columns whose value is missing in this row."),
    ]


class Kind(StrEnum):
    bins = "bins"
    top_values = "top_values"


class HistogramBar(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    label: str
    count: Annotated[int, Field(ge=0)]


class CorrelationPair(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    column_a: str
    column_b: str
    pearson: float
    rows: Annotated[int, Field(description="Rows where both columns are present.", ge=0)]


class Library(StrEnum):
    matplotlib = "matplotlib"
    plotly = "plotly"
    altair = "altair"


class Format(StrEnum):
    svg = "svg"
    plotly_json = "plotly_json"
    vega_lite_json = "vega_lite_json"


class Figure(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    library: Library
    format: Format
    title: str | None = None
    content: Annotated[
        str,
        Field(
            description="SVG markup, a Plotly figure as JSON text, or a Vega-Lite spec as JSON text (Altair)."
        ),
    ]


class Kind1(StrEnum):
    text = "text"
    table = "table"
    image = "image"
    figure = "figure"


class Channel(StrEnum):
    stdout = "stdout"
    stderr = "stderr"


class CodeFileRead(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    path: str
    reader: Annotated[str, Field(description="The call that reads it, e.g. read_csv or open.")]
    line: Annotated[int, Field(ge=0)]


class ValueType(StrEnum):
    integer = "integer"
    number = "number"
    string = "string"
    boolean = "boolean"


class Cell(RootModel[str]):
    root: Annotated[str, Field(max_length=100000)]


class CellRange(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    first: Annotated[int, Field(ge=0)]
    last: Annotated[int, Field(ge=0)]


class Cell1(RootModel[int]):
    root: Annotated[int, Field(ge=0)]


class SplitParameter(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    name: str
    value: int | float | str | bool


class SplitNote(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    cell: Annotated[int, Field(description="Index (from 0) of the cell the note is about.", ge=0)]
    message: str


class CodeField(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    name: str
    data_type: Annotated[str, Field(description="Polars data type name, for display only.")]
    null_count: Annotated[int, Field(ge=0)]


class ArtifactId(RootModel[str]):
    root: Annotated[str, Field(pattern="^art_[0-9A-HJKMNP-TV-Z]{26}$")]


class ProjectId(RootModel[str]):
    root: Annotated[str, Field(pattern="^prj_[0-9A-HJKMNP-TV-Z]{26}$")]


class AttemptId(RootModel[str]):
    root: Annotated[str, Field(pattern="^att_[0-9A-HJKMNP-TV-Z]{26}$")]


class SchemaId(RootModel[str]):
    root: Annotated[str, Field(pattern="^sch_[0-9A-HJKMNP-TV-Z]{26}$")]


class ContentHash(RootModel[str]):
    root: Annotated[str, Field(pattern="^sha256:[0-9a-f]{64}$")]


class Timestamp(RootModel[str]):
    root: Annotated[
        str,
        Field(
            description="UTC, whole seconds, Z suffix. One canonical form so every language round-trips it unchanged. Pattern only: typify ignores pattern when format is set.",
            pattern="^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]Z$",
        ),
    ]


class InvestigationId(RootModel[str]):
    root: Annotated[str, Field(pattern="^inv_[0-9A-HJKMNP-TV-Z]{26}$")]


class QuestionVersionId(RootModel[str]):
    root: Annotated[str, Field(pattern="^qv_[0-9A-HJKMNP-TV-Z]{26}$")]


class MethodologyProposalId(RootModel[str]):
    root: Annotated[str, Field(pattern="^mpr_[0-9A-HJKMNP-TV-Z]{26}$")]


class MethodologyDecisionId(RootModel[str]):
    root: Annotated[str, Field(pattern="^mdc_[0-9A-HJKMNP-TV-Z]{26}$")]


class PipelineVersionId(RootModel[str]):
    root: Annotated[str, Field(pattern="^plv_[0-9A-HJKMNP-TV-Z]{26}$")]


class NotebookId(RootModel[str]):
    root: Annotated[str, Field(pattern="^nb_[0-9A-HJKMNP-TV-Z]{26}$")]


class NotebookVersionId(RootModel[str]):
    root: Annotated[str, Field(pattern="^nbv_[0-9A-HJKMNP-TV-Z]{26}$")]


class RunId(RootModel[str]):
    root: Annotated[str, Field(pattern="^run_[0-9A-HJKMNP-TV-Z]{26}$")]


class WorkerId(RootModel[str]):
    root: Annotated[str, Field(pattern="^wrk_[0-9A-HJKMNP-TV-Z]{26}$")]


class NodeId(RootModel[str]):
    root: Annotated[
        str,
        Field(
            description="Node name, unique within a pipeline version.",
            pattern="^[a-z][a-z0-9_]{0,62}$",
        ),
    ]


class PortName(RootModel[str]):
    root: Annotated[str, Field(pattern="^[a-z][a-z0-9_]{0,62}$")]


class OperatorRef(RootModel[str]):
    root: Annotated[
        str,
        Field(
            description="Pinned operator: dotted name @ semver, e.g. sprisk.eval.binary_classification@1.0.0.",
            pattern="^[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)+@(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$",
        ),
    ]


class Params(StrictModel):
    model_config = ConfigDict(
        extra="allow",
    )


class Error(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    code: Annotated[str, Field(pattern="^[a-z][a-z0-9_]*$")]
    message: Annotated[str, Field(min_length=1)]


class ShortlistItem(RootModel[str]):
    root: Annotated[str, Field(pattern="^[a-z][a-z0-9_]{0,62}$")]


class Applicability(StrEnum):
    applicable = "applicable"
    needs_fact = "needs_fact"
    not_applicable = "not_applicable"


class Alternative(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: Annotated[str, Field(pattern="^[a-z][a-z0-9_]{0,62}$")]
    applicability: Applicability
    reason: Annotated[str, Field(min_length=1)]
    params: Annotated[
        Params | None,
        Field(
            description="Concrete params for the manifest action's operator; present when applicable."
        ),
    ] = None


class MethodologyRuleRef(RootModel[str]):
    root: Annotated[
        str,
        Field(
            description="methodology.<pack>.<rule>@<semver>",
            pattern="^methodology\\.[a-z][a-z0-9_]*\\.[a-z][a-z0-9_]*@\\d+\\.\\d+\\.\\d+$",
        ),
    ]


class MethodologyStage(StrEnum):
    question = "question"
    data = "data"
    cleaning = "cleaning"
    split = "split"
    features = "features"
    models = "models"
    evaluation = "evaluation"
    reporting = "reporting"


class Selection(StrEnum):
    recommend = "recommend"
    shortlist = "shortlist"


class Status(StrEnum):
    draft = "draft"
    active = "active"


class AppliesToItem(RootModel[str]):
    root: Annotated[str, Field(pattern="^[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)+$")]


class Read(RootModel[str]):
    root: Annotated[str, Field(min_length=1)]


class CornerCase(RootModel[str]):
    root: Annotated[str, Field(min_length=1)]


class Provenance(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    standard: Annotated[str, Field(min_length=1)]
    citation: Annotated[str, Field(min_length=1)]
    pitfall: Annotated[str, Field(min_length=1)]
    corner_cases: list[CornerCase]


class Observes(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    profile: Annotated[str, Field(min_length=1)]
    description: str
    required: bool


class Observes1(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    fact: Annotated[str, Field(min_length=1)]
    description: str
    required: bool


class Verification(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    check_id: Annotated[str, Field(min_length=1)]
    invariant: Annotated[str, Field(min_length=1)]


class Language(StrEnum):
    yaml = "yaml"
    python = "python"


class File(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    path: Annotated[
        str,
        Field(
            description="Relative to the rule folder, e.g. rule.yaml. Never an absolute path.",
            pattern="^[A-Za-z0-9_][A-Za-z0-9_./-]*$",
        ),
    ]
    language: Language
    text: str


class MethodologyRuleSource(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    rule: MethodologyRuleRef
    files: Annotated[list[File], Field(min_length=1)]


class Kind2(StrEnum):
    question_fact = "question_fact"
    profile_fact = "profile_fact"
    flow_fact = "flow_fact"
    policy = "policy"
    user_reason = "user_reason"


class RuleActionType(StrEnum):
    replace_node = "replace_node"
    remove_node = "remove_node"
    insert_step = "insert_step"
    pass_through = "pass_through"
    update_estimator_params = "update_estimator_params"
    configure_clustering_cardinality = "configure_clustering_cardinality"
    configure_clustering_distance = "configure_clustering_distance"
    configure_dbscan_params = "configure_dbscan_params"
    configure_evaluation_params = "configure_evaluation_params"
    emit_methodology_limitation = "emit_methodology_limitation"
    enforce_compiler_invariant = "enforce_compiler_invariant"


class GraphEffect1(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    kind: Literal["replace_node"]
    node_id: NodeId
    operator: OperatorRef
    params: Params


class GraphEffect2(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    kind: Literal["remove_node"]
    node_id: NodeId


class GraphEffect(RootModel[GraphEffect1 | GraphEffect2]):
    root: Annotated[
        GraphEffect1 | GraphEffect2,
        Field(
            description="Typed mutation previewed and compiled before it can create a pipeline version."
        ),
    ]


class MethodologyAlternative(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: Annotated[str, Field(pattern="^[a-z][a-z0-9_]{0,62}$")]
    label: Annotated[str, Field(min_length=1)]
    description: Annotated[str, Field(min_length=1)]
    applicability: Applicability
    reason: Annotated[str, Field(min_length=1)]
    effect: GraphEffect | None = None


class ApplyMethodologyDecision(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    alternative_id: Annotated[str, Field(pattern="^[a-z][a-z0-9_]{0,62}$")]
    reason: Annotated[str | None, Field(min_length=1)] = None
    idempotency_key: Annotated[str, Field(max_length=128, min_length=8)]


class MethodologyCheckId(RootModel[str]):
    root: Annotated[str, Field(pattern="^mck_[0-9A-HJKMNP-TV-Z]{26}$")]


class CheckRef(RootModel[str]):
    root: Annotated[
        str,
        Field(
            description="Pinned rule: <pack>.<rule>@<semver>.",
            pattern="^[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)+@(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$",
        ),
    ]


class Verdict(StrEnum):
    pass_ = "pass"
    fail = "fail"
    warning = "warning"
    not_assessed = "not_assessed"


class MethodologyPhase(StrEnum):
    plan = "plan"
    code = "code"
    runtime = "runtime"
    result = "result"
    release = "release"


class MethodologyCoverage(StrEnum):
    complete = "complete"
    partial = "partial"
    not_assessed = "not_assessed"


class Kind3(StrEnum):
    code = "code"
    markdown = "markdown"


class NotebookCellId(RootModel[str]):
    root: Annotated[
        str,
        Field(
            description="Stable within a notebook across versions, as in Jupyter's nbformat 4.5.",
            pattern="^[A-Za-z0-9_-]{1,64}$",
        ),
    ]


class NotebookExecute(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    cell_id: NotebookCellId
    code: Annotated[str, Field(max_length=100000)]


class Status1(StrEnum):
    ok = "ok"
    error = "error"
    interrupted = "interrupted"
    timed_out = "timed_out"


class NotebookError(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    name: str
    message: str
    traceback: Annotated[list[str], Field(description="Plain text lines, colour codes removed.")]


class NotebookVariable(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    name: PortName
    defined: bool
    type: Annotated[
        str | None,
        Field(description="Module and class, e.g. pandas.DataFrame. Absent when not defined."),
    ] = None
    table: Annotated[
        bool,
        Field(
            description="A pandas or polars DataFrame: the one kind of value that crosses a node boundary today."
        ),
    ]


class KernelExecute(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    op: Literal["execute"]
    code: Annotated[str, Field(max_length=100000)]


class KernelInterrupt(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    op: Literal["interrupt"]


class KernelVariables(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    op: Literal["variables"]
    names: list[PortName]


class KernelShutdown(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    op: Literal["shutdown"]


class Entrypoint(RootModel[str]):
    root: Annotated[str, Field(pattern="^[a-z_][a-z0-9_]*(\\.[a-z_][a-z0-9_]*)*:[a-z_][a-z0-9_]*$")]


class ModelPreparation(StrEnum):
    fill_gaps = "fill_gaps"
    standardize = "standardize"


class ModelFamily(StrEnum):
    tree_ensemble = "tree_ensemble"
    linear = "linear"
    distance_based = "distance_based"
    density_based = "density_based"


class CapabilityClass(StrEnum):
    source = "source"
    transform = "transform"
    analyzer = "analyzer"
    estimator = "estimator"
    evaluator = "evaluator"
    optimizer = "optimizer"
    decision_evaluator = "decision_evaluator"
    sink = "sink"
    custom_code = "custom_code"


class PortKind(StrEnum):
    table = "table"
    model = "model"
    metrics = "metrics"
    diagnostics = "diagnostics"
    report = "report"
    figure = "figure"


class Effects(StrEnum):
    pure = "pure"
    nondeterministic = "nondeterministic"
    side_effecting = "side_effecting"


class NetworkAccess(StrEnum):
    none = "none"
    egress_allowlisted = "egress_allowlisted"


class Gpu(StrEnum):
    none = "none"
    optional = "optional"
    required = "required"


class Resources(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    cpu_cores: Annotated[int, Field(ge=1)]
    memory_mb: Annotated[int, Field(ge=1)]
    gpu: Gpu
    timeout_seconds: Annotated[int, Field(ge=1)]


class NodeSource(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    notebook_version_id: NotebookVersionId
    notebook_id: Annotated[
        NotebookId | None,
        Field(
            description="The notebook these cells belong to, so saving it again rebuilds its steps (ADR-0037). Absent on nodes made before."
        ),
    ] = None
    cells: list[NotebookCellId]


class NodeCode(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    source: Annotated[str, Field(description="Python module source.", max_length=200000)]
    function: Annotated[
        str,
        Field(
            description="The function in source that is the step.",
            pattern="^[A-Za-z_][A-Za-z0-9_]*$",
        ),
    ]


class PortRef(RootModel[str]):
    root: Annotated[
        str,
        Field(
            description="`<node_id>.<port_name>`.",
            pattern="^[a-z][a-z0-9_]{0,62}\\.[a-z][a-z0-9_]{0,62}$",
        ),
    ]


class Origin(StrEnum):
    explicit = "explicit"
    inferred = "inferred"
    measured = "measured"
    confirmed = "confirmed"


class Fact(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    value: Annotated[str, Field(min_length=1)]
    origin: Origin


class TaskType(StrEnum):
    exploration = "exploration"
    classification = "classification"
    regression = "regression"
    undetermined = "undetermined"


class Blocks(StrEnum):
    planning = "planning"
    execution = "execution"
    release = "release"


class Unknown(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    question: Annotated[str, Field(min_length=1)]
    blocks: Annotated[
        Blocks, Field(description="Earliest stage this unknown must be resolved before.")
    ]


class RunStatus(StrEnum):
    queued = "queued"
    running = "running"
    succeeded = "succeeded"
    failed = "failed"
    cancelled = "cancelled"


class AttemptState(StrEnum):
    created = "created"
    validated = "validated"
    queued = "queued"
    leased = "leased"
    running = "running"
    uploading = "uploading"
    succeeded = "succeeded"
    failed = "failed"
    cancelled = "cancelled"
    timed_out = "timed_out"
    skipped = "skipped"
    cache_hit = "cache_hit"


class Limitation(RootModel[str]):
    root: Annotated[str, Field(min_length=1)]


class SelectionMetric(StrEnum):
    balanced_accuracy = "balanced_accuracy"
    rmse = "rmse"


class BaselineComparison(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    mean_difference: Annotated[
        float,
        Field(
            description="Mean fold-by-fold improvement over the baseline on the same folds; positive is better for either metric."
        ),
    ]
    corrected_se: Annotated[
        float,
        Field(
            description="Standard error of that mean, corrected for folds that share train rows (Nadeau & Bengio 2003)."
        ),
    ]
    beats_baseline: Annotated[
        bool, Field(description="Whether mean_difference is larger than corrected_se.")
    ]


class Handshake(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    type: Literal["handshake"]
    protocol_version: Literal["sprisk.worker/v1"]
    worker_id: WorkerId
    operators: list[OperatorRef]


class Heartbeat(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    type: Literal["heartbeat"]
    attempt_id: AttemptId


class Progress(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    type: Literal["progress"]
    attempt_id: AttemptId
    completed: Annotated[int, Field(ge=0)]
    total: Annotated[int, Field(ge=0)]


class ArtifactManifest(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    type: Literal["artifact_manifest"]
    attempt_id: AttemptId
    port: PortName
    staging_uri: Annotated[str, Field(pattern="^[a-z][a-z0-9+.-]*://.+$")]
    content_hash: ContentHash
    media_type: Annotated[str, Field(pattern="^[a-z]+/[a-z0-9.+-]+$")]
    schema_ref: SchemaId | None = None
    size_bytes: Annotated[int, Field(ge=0)]


class Complete(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    type: Literal["complete"]
    attempt_id: AttemptId


class FailureKind(StrEnum):
    transient = "transient"
    permanent = "permanent"


class Fail(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    type: Literal["fail"]
    attempt_id: AttemptId
    error: Error
    failure_kind: FailureKind


class Cancel(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    type: Literal["cancel"]
    attempt_id: AttemptId


class Acknowledge(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    type: Literal["acknowledge"]
    attempt_id: AttemptId


class InputBinding(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    port: PortName
    artifact_id: ArtifactId
    uri: Annotated[str, Field(pattern="^[a-z][a-z0-9+.-]*://.+$")]
    content_hash: ContentHash


class CreateRun(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    pipeline_version_id: PipelineVersionId
    reuse_run_id: Annotated[
        RunId | None,
        Field(
            description="Reuse this run's results for every step whose definition is unchanged; run the rest (ADR-0026). Omitted: run from the start."
        ),
    ] = None


class Problem(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    errors: list[Error]


class TablePage(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    offset: Annotated[int, Field(description="Index of the first row in this page.", ge=0)]
    total_rows: Annotated[int, Field(ge=0)]
    total_columns: Annotated[
        int,
        Field(
            description="Columns in the table; more than `columns` holds when the table is too wide to page whole.",
            ge=0,
        ),
    ]
    columns: list[TableColumn]
    rows: list[TableRow]


class OperatorSource(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    operator: OperatorRef
    path: Annotated[
        str,
        Field(
            description="Relative to the pack's src/, e.g. sprisk_clean/impute.py. Never an absolute path."
        ),
    ]
    language: Literal["python"]
    text: str
    digest: Annotated[
        ContentHash,
        Field(
            description="The operator's implementation digest: the code that runs, and the code shown, are the same."
        ),
    ]


class LoadedTableUse(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    pipeline_version_id: PipelineVersionId
    run_id: Annotated[
        RunId,
        Field(description="The latest run of that version, whose source step loaded the table."),
    ]
    node_id: NodeId


class Histogram(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    kind: Annotated[
        Kind,
        Field(
            description="bins: equal-width bins of a numeric column. top_values: the most common values of any other column."
        ),
    ]
    bars: list[HistogramBar]


class Correlation(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    columns: list[str]
    pairs: list[CorrelationPair]


class FigureSet(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    items: list[Figure]


class DisplayItem(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    kind: Kind1
    text: Annotated[str | None, Field(description="Present for kind text.")] = None
    table: Annotated[
        TablePage | None, Field(description="Present for kind table: the first rows only.")
    ] = None
    figure: Annotated[
        Figure | None,
        Field(
            description="Present for kind figure: a plot the code drew, as SVG, Plotly or Vega-Lite (ADR-0024)."
        ),
    ] = None
    png_base64: Annotated[
        str | None,
        Field(
            description="Present for kind image: a PNG, base64-encoded. Written by older code steps; new ones write figures."
        ),
    ] = None
    label: Annotated[
        str | None,
        Field(
            description="The code that was shown, as written: a name such as summary, or an expression such as df.head(). Absent for printed text, figures shown at the end, and older code steps."
        ),
    ] = None
    line: Annotated[
        int | None,
        Field(
            description="The line of the step's code that showed it: a show() or display() call, or the last line. Absent when it was shown at the end of the run, or by older code steps.",
            ge=0,
        ),
    ] = None
    channel: Annotated[
        Channel | None,
        Field(
            description="For printed text: which stream it came from. Absent for displayed values. Warnings arrive on stderr."
        ),
    ] = None


class CodeInput(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    name: str
    origin: Origin
    bound: Annotated[
        bool,
        Field(
            description="True when the name is provided by the step (its input table or a library); false means the code reads a name nothing defines."
        ),
    ]


class CodeParameter(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    name: str
    line: Annotated[int, Field(ge=0)]
    value_type: ValueType
    default_text: Annotated[str, Field(description="The literal as written in the source.")]
    effective_text: Annotated[str, Field(description="The literal the run used, as Python source.")]
    origin: Annotated[Origin, Field(description="inferred until the user exposes it (confirmed).")]


class CodeOutputCandidate(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    name: str
    type: Annotated[
        str, Field(description="Python type of the final value, e.g. polars.DataFrame.")
    ]
    rows: Annotated[int | None, Field(ge=0)] = None
    columns: Annotated[int | None, Field(ge=0)] = None
    origin: Origin
    chosen: Annotated[bool, Field(description="This value became the step's data output.")]
    fields: Annotated[
        list[CodeField] | None,
        Field(
            description="For tables: their columns with type and missing count, for the Data tab's variable explorer (ADR-0030). Capped."
        ),
    ] = None
    sample: Annotated[
        TablePage | None,
        Field(
            description="For tables: the first rows (ADR-0030). Omitted once the report's size budget is used up."
        ),
    ] = None
    text: Annotated[
        str | None,
        Field(description="For other values: their repr, cut to a bounded length (ADR-0030)."),
    ] = None


class CodeSplitRequest(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    cells: list[Cell]
    together: Annotated[
        CellRange | None,
        Field(
            description="Cells first..last (from 0) start as one step: the cells a person picked for Create node (ADR-0036). Absent: every cell starts alone."
        ),
    ] = None


class SplitStep(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    source: Annotated[
        str,
        Field(
            description="The step's code: its cells, with the imports and literals it uses from earlier cells copied in."
        ),
    ]
    parameters: Annotated[
        list[SplitParameter],
        Field(
            description="Top-level literals in the step's code, its own or copied in, that can be exposed as settings."
        ),
    ]
    cells: Annotated[
        list[Cell1], Field(description="Indexes (from 0) of the cells this step holds.")
    ]
    inputs: list[PortName]
    outputs: list[PortName]


class SplitLink(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    from_step: Annotated[int, Field(ge=0)]
    to_step: Annotated[int, Field(ge=0)]
    name: PortName


class Artifact(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    schema_version: Literal["sprisk.artifact/v1"]
    id: ArtifactId
    project_id: ProjectId
    producer_attempt_id: AttemptId
    content_hash: ContentHash
    media_type: Annotated[
        str,
        Field(description="IANA media type of the stored bytes.", pattern="^[a-z]+/[a-z0-9.+-]+$"),
    ]
    schema_ref: Annotated[
        SchemaId | None,
        Field(
            description="Declared data schema. Absent for artifacts without a tabular schema, such as model bundles."
        ),
    ] = None
    size_bytes: Annotated[int, Field(ge=0)]
    uri: Annotated[
        str,
        Field(
            description="Storage location. Opaque to domain logic; resolved by the artifact store.",
            pattern="^[a-z][a-z0-9+.-]*://.+$",
        ),
    ]
    created_at: Timestamp


class RuleObservation(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    schema_version: Literal["sprisk.rule_observation/v1"]
    rule: MethodologyRuleRef
    facts: Annotated[
        dict[str, Fact],
        Field(
            description="Facts by name: question facts (question.time_column), facts read from the flow (flow.model_families), and the step's own text settings (step.method). A fact that lists several values joins them, sorted, with ', '."
        ),
    ]
    profile: Annotated[
        dict[str, float | str | bool], Field(description="Measured profile values by name.")
    ]
    settings: Annotated[
        dict[str, Any],
        Field(description="The rule's settings: policy thresholds with any overrides."),
    ]


class Action(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    type: RuleActionType
    operator: Annotated[
        str | None,
        Field(
            description="Operator the action builds; may name one not yet registered.", min_length=1
        ),
    ] = None
    placement: Annotated[str | None, Field(min_length=1)] = None
    fit_on: Annotated[str | None, Field(min_length=1)] = None
    apply_to: Annotated[str | None, Field(min_length=1)] = None
    params: Annotated[
        dict[str, Any] | None,
        Field(
            description="Operator params; '{settings.x}' strings are filled from the alternative's settings."
        ),
    ] = None


class Alternative1(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: Annotated[str, Field(pattern="^[a-z][a-z0-9_]{0,62}$")]
    label: Annotated[str, Field(min_length=1)]
    description: Annotated[str, Field(min_length=1)]
    condition: Annotated[
        str | None,
        Field(
            description="A draft rule's design note on when this applies. An active rule has none: its decide() is the logic, shown by its examples (ADR-0045)."
        ),
    ] = None
    rationale: Annotated[str, Field(min_length=1)]
    settings_schema: Annotated[
        dict[str, Any] | None, Field(description="JSON Schema for this alternative's settings.")
    ] = None
    action: Action


class MethodologyEvidence(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    kind: Kind2
    label: Annotated[str, Field(min_length=1)]
    value: Annotated[str, Field(min_length=1)]
    origin: Origin
    artifact_id: ArtifactId | None = None


class Given(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    value: Annotated[str, Field(min_length=1)]
    origin: Origin


class RuleExample(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    given: Annotated[
        dict[str, str | float | Given],
        Field(
            description="Facts by name. A question fact is confirmed and a flow fact measured unless given as { value, origin }."
        ),
    ]
    picks: Annotated[
        str | None,
        Field(description="What a recommend rule picks.", pattern="^[a-z][a-z0-9_]{0,62}$"),
    ] = None
    shortlist: Annotated[
        list[ShortlistItem] | None, Field(description="What a shortlist rule puts forward.")
    ] = None


class DecisionProposal(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    schema_version: Literal["sprisk.decision_proposal/v1"]
    id: MethodologyProposalId
    rule: CheckRef
    question_version_id: QuestionVersionId
    pipeline_version_id: PipelineVersionId
    subject_node_id: NodeId
    evidence: list[MethodologyEvidence]
    alternatives: Annotated[list[MethodologyAlternative], Field(min_length=1)]
    recommended_alternative_id: Annotated[str | None, Field(pattern="^[a-z][a-z0-9_]{0,62}$")] = (
        None
    )
    shortlist: Annotated[
        list[ShortlistItem] | None,
        Field(description="The alternatives a shortlist rule puts forward to compare (ADR-0044)."),
    ] = None
    fingerprint: ContentHash
    created_at: Timestamp


class MethodologyDecision(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    schema_version: Literal["sprisk.methodology_decision/v1"]
    id: MethodologyDecisionId
    proposal_id: MethodologyProposalId
    rule: CheckRef
    question_version_id: QuestionVersionId
    base_pipeline_version_id: PipelineVersionId
    pipeline_version_id: PipelineVersionId
    subject_node_id: NodeId
    alternative_id: Annotated[str, Field(pattern="^[a-z][a-z0-9_]{0,62}$")]
    reason: Annotated[str | None, Field(min_length=1)] = None
    created_at: Timestamp


class MethodologyCheck(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    schema_version: Literal["sprisk.methodology_check/v1"]
    id: MethodologyCheckId
    pipeline_version_id: PipelineVersionId
    question_version_id: QuestionVersionId | None = None
    methodology_decision_id: MethodologyDecisionId | None = None
    check: CheckRef
    phase: MethodologyPhase | None = None
    coverage: MethodologyCoverage | None = None
    verdict: Verdict
    rationale: Annotated[str, Field(min_length=1)]
    cited_nodes: Annotated[
        list[NodeId],
        Field(
            description="Nodes the verdict is about. Empty when the rule found nothing to inspect."
        ),
    ]
    limitations: Annotated[
        str | None,
        Field(
            description="What the rule could not assess. Omitted when there is nothing to say.",
            min_length=1,
        ),
    ] = None
    created_at: Timestamp


class NotebookCell(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: NotebookCellId
    kind: Kind3
    source: Annotated[str, Field(max_length=100000)]


class NotebookExecution(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    status: Status1
    execution_count: Annotated[
        int | None,
        Field(
            description="The kernel's count for this execution. Absent when the cell never got one (timed out before it started).",
            ge=0,
        ),
    ] = None
    outputs: list[DisplayItem]
    error: Annotated[
        NotebookError | None, Field(description="Present when status is error or interrupted.")
    ] = None
    kernel_restarted: Annotated[
        bool | None,
        Field(
            description="Present and true when the kernel restarted before or during this cell (memory cap, crash, stuck interrupt): every variable is gone. Absent otherwise."
        ),
    ] = None


class ExecutionRunning(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    kind: Literal["running"]
    execution_count: Annotated[
        int | None,
        Field(description="The kernel's count for this execution, once it has one.", ge=0),
    ] = None
    outputs: Annotated[
        list[DisplayItem],
        Field(description="Every output so far, not only the new ones, capped as in the result."),
    ]


class ExecutionDone(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    kind: Literal["done"]
    execution: NotebookExecution


class ExecutionFailed(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    kind: Literal["failed"]
    problem: Problem


class NotebookVariables(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    variables: list[NotebookVariable]


class NotebookKernelRequest(
    RootModel[KernelExecute | KernelInterrupt | KernelVariables | KernelShutdown]
):
    root: Annotated[
        KernelExecute | KernelInterrupt | KernelVariables | KernelShutdown,
        Field(
            description="Rust to the session host, one JSON line each (ADR-0036). Tagged by `op`. The host answers execute with NotebookExecutionEvent lines ending in `done` (ADR-0041) and variables with NotebookVariables; interrupt and shutdown get no answer.",
            title="NotebookKernelRequest",
        ),
    ]


class OperatorModel(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    family: Annotated[
        ModelFamily | None,
        Field(
            description="Left out for a model that ignores its features, such as a dummy baseline."
        ),
    ] = None
    tasks: Annotated[
        list[TaskType] | None,
        Field(
            description="The supervised tasks the model fits, so a shortlist rule can offer it (ADR-0044)."
        ),
    ] = None
    prepares: Annotated[
        list[ModelPreparation],
        Field(
            description="Preparation the model fits on its own train rows, inside the model; empty when it takes its inputs as they are."
        ),
    ]
    estimator: Annotated[
        Entrypoint | None,
        Field(
            description="Python `module:function` returning the model unfitted, given `schema` (the feature columns' types) and its params except target and features, so cross-validation can refit it per fold (ADR-0044, ADR-0046). Set on every supervised model."
        ),
    ] = None


class Port(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    name: PortName
    kind: PortKind
    description: str | None = None


class Node(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: NodeId
    operator: OperatorRef
    params: Params
    methodology_decision_id: Annotated[
        MethodologyDecisionId | None,
        Field(
            description="Decision that produced this node state. Absent for a hand-authored node."
        ),
    ] = None
    code: Annotated[
        NodeCode | None,
        Field(
            description="This step's own code in this version, replacing its operator's implementation (ADR-0028). Omitted: the operator's code runs."
        ),
    ] = None
    from_notebook: Annotated[
        NodeSource | None,
        Field(
            description="The notebook cells this node was created from (ADR-0036). Omitted: not made from a notebook."
        ),
    ] = None


class Edge(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    from_: Annotated[PortRef, Field(alias="from")]
    to: PortRef


class TaskFact(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    value: TaskType
    origin: Origin


class Run(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    schema_version: Literal["sprisk.run/v1"]
    id: RunId
    project_id: ProjectId
    pipeline_version_id: PipelineVersionId
    status: RunStatus
    reuse_run_id: Annotated[
        RunId | None,
        Field(
            description="The run whose unchanged results this run reused (ADR-0026). Omitted when it ran from the start."
        ),
    ] = None
    created_at: Timestamp
    finished_at: Annotated[
        Timestamp | None, Field(description="Set once the run reaches a terminal status.")
    ] = None


class Attempt(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    schema_version: Literal["sprisk.attempt/v1"]
    id: AttemptId
    run_id: RunId
    node_id: NodeId
    number: Annotated[int, Field(description="1 for the first try of this step.", ge=1)]
    state: AttemptState
    worker_id: Annotated[WorkerId | None, Field(description="Set once leased.")] = None
    lease_expires_at: Annotated[Timestamp | None, Field(description="Set while leased.")] = None
    error: Annotated[Error | None, Field(description="Set when state is failed or timed_out.")] = (
        None
    )
    created_at: Timestamp


class CandidateResult(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: Annotated[
        str, Field(description="The shortlist alternative.", pattern="^[a-z][a-z0-9_]{0,62}$")
    ]
    fold_scores: Annotated[
        list[float], Field(description="The metric on each fold's validation rows, in fold order.")
    ]
    mean: float
    spread: Annotated[float, Field(description="Standard deviation of the fold scores.")]
    versus_baseline: Annotated[
        BaselineComparison | None, Field(description="Absent for the baseline itself.")
    ] = None


class LeaseAttempt(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    type: Literal["lease_attempt"]
    attempt_id: AttemptId
    run_id: RunId
    node_id: NodeId
    operator: OperatorRef
    params: Params
    inputs: list[InputBinding]
    code: Annotated[
        NodeCode | None,
        Field(
            description="The step's own code (ADR-0028): run this function instead of the operator's."
        ),
    ] = None
    staging_uri: Annotated[
        str,
        Field(
            description="Only location the worker may write outputs to. Scoped to this attempt.",
            pattern="^[a-z][a-z0-9+.-]*://.+$",
        ),
    ]
    lease_expires_at: Timestamp


class AttemptOutput(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    port: PortName
    artifact: Artifact


class LoadedTable(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    name: Annotated[
        str,
        Field(
            description="The file name the source step reads, or the step's id when it reads no file."
        ),
    ]
    operator: OperatorRef
    artifact: Artifact
    total_rows: Annotated[int, Field(ge=0)]
    total_columns: Annotated[int, Field(ge=0)]
    used_by: list[LoadedTableUse]


class ColumnProfile(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    name: str
    data_type: Annotated[str, Field(description="Polars data type name, for display only.")]
    missing: Annotated[int, Field(description="Empty cells, NaN and infinity.", ge=0)]
    distinct: Annotated[int, Field(description="Distinct values, not counting missing.", ge=0)]
    skewness: Annotated[
        float | None,
        Field(description="Sample skewness of a numeric column with variation; absent otherwise."),
    ] = None
    kurtosis: Annotated[
        float | None,
        Field(
            description="Excess (Fisher) kurtosis of a numeric column with variation; absent otherwise."
        ),
    ] = None
    outlier_share: Annotated[
        float | None,
        Field(
            description="Share of present values outside the 1.5 x IQR fences, for a numeric column with variation.",
            ge=0.0,
            le=1.0,
        ),
    ] = None
    iqr: Annotated[
        float | None,
        Field(
            description="Interquartile range of a numeric column with variation. Zero when most values are equal: IQR fences and robust scaling then have no spread to use.",
            ge=0.0,
        ),
    ] = None
    missing_by_band: Annotated[
        list[float],
        Field(description="Share of missing cells (0 to 1) in each row band, in row order."),
    ]
    histogram: Annotated[
        Histogram | None, Field(description="Absent when every value is missing.")
    ] = None


class CodeDisplay(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    items: list[DisplayItem]


class CodeInterface(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    inputs: list[CodeInput]
    parameters: list[CodeParameter]
    outputs: list[CodeOutputCandidate]
    files: Annotated[
        list[CodeFileRead] | None,
        Field(
            description="Files the code reads (ADR-0025): inputs, never parameters. Omitted in reports written before ADR-0025."
        ),
    ] = None


class CodeSplit(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    steps: list[SplitStep]
    links: list[SplitLink]
    notes: list[SplitNote]


class RuleDecision(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    schema_version: Literal["sprisk.rule_decision/v1"]
    rule: MethodologyRuleRef
    recommended_alternative_id: Annotated[
        str | None,
        Field(
            description="The one alternative a recommend rule picks; absent for a shortlist rule.",
            pattern="^[a-z][a-z0-9_]{0,62}$",
        ),
    ] = None
    shortlist: Annotated[
        list[ShortlistItem] | None,
        Field(
            description="The alternatives a shortlist rule puts forward to compare; absent for a recommend rule (ADR-0044)."
        ),
    ] = None
    alternatives: Annotated[list[Alternative], Field(min_length=1)]
    evidence: list[MethodologyEvidence]


class MethodologyRule(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    schema_version: Literal["sprisk.methodology_rule/v1"]
    id: MethodologyRuleRef
    name: Annotated[str, Field(min_length=1)]
    stage: MethodologyStage
    selection: Annotated[
        Selection | None,
        Field(
            description="recommend (the default): decide() picks one alternative. shortlist: it puts forward the registry's models worth comparing (ADR-0044)."
        ),
    ] = None
    status: Annotated[
        Status,
        Field(
            description="draft: a design with no rule.py, never run; its condition and observes are notes. active: has rule.py, applies_to, reads and examples, and no notes (ADR-0045)."
        ),
    ]
    applies_to: Annotated[
        list[AppliesToItem] | None,
        Field(
            description="Operators, without version, whose steps this active rule decides. Rust routes from it (ADR-0045)."
        ),
    ] = None
    reads: Annotated[
        list[Read] | None,
        Field(
            description="Facts this active rule may read, by name from the fact catalog, e.g. question.target or column.*.kurtosis; * stands for a column or setting name. Rust sends only these (ADR-0045)."
        ),
    ] = None
    examples: Annotated[
        list[RuleExample] | None,
        Field(
            description="Inputs and the alternative decide() picks for them. Run as tests and shown in place of conditions (ADR-0045)."
        ),
    ] = None
    decides: Annotated[
        str,
        Field(
            description="The one decision this rule owns; unique across loaded packs.",
            pattern="^[a-z][a-z0-9_]*\\.[a-z][a-z0-9_]*$",
        ),
    ]
    provenance: Provenance
    observes: Annotated[
        list[Observes | Observes1] | None,
        Field(
            description="Design notes on a draft rule's inputs; an active rule declares reads instead."
        ),
    ] = None
    policy_thresholds: Annotated[
        dict[str, Any], Field(description="Default thresholds the rule decides with.")
    ]
    alternatives: Annotated[
        list[Alternative1],
        Field(
            description="A recommend rule's menu. A shortlist rule has none: its candidates come from the registry (ADR-0044)."
        ),
    ]
    verification: Verification


class NotebookVersion(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    schema_version: Literal["sprisk.notebook_version/v1"]
    id: NotebookVersionId
    notebook_id: NotebookId
    project_id: ProjectId
    parent_id: Annotated[
        NotebookVersionId | None,
        Field(
            description="Version this one was saved over. Absent for a notebook's first version."
        ),
    ] = None
    pipeline_version_id: Annotated[
        PipelineVersionId | None,
        Field(
            description="The flow version this notebook was made in or last synced into (ADR-0037). The notebook belongs to that flow and its later versions. Absent: not in a flow yet."
        ),
    ] = None
    title: Annotated[str, Field(max_length=200)]
    cells: list[NotebookCell]
    created_at: Timestamp
    removed: Annotated[
        bool | None,
        Field(
            description="Present and true: the notebook was deleted in this version (ADR-0041). It is no longer listed; its history stays readable. Absent otherwise."
        ),
    ] = None


class NotebookExecutionEvent(RootModel[ExecutionRunning | ExecutionDone | ExecutionFailed]):
    root: Annotated[
        ExecutionRunning | ExecutionDone | ExecutionFailed,
        Field(
            description="One line of a cell's execution as it happens (ADR-0041), from the session host to Rust and, when asked with Accept: application/x-ndjson, from POST /notebooks/{id}/execute to the browser. Tagged by `kind`: `running` lines carry every output so far; the last line is `done`, or `failed` when the kernel stopped answering after the stream began (earlier failures are an HTTP error).",
            title="NotebookExecutionEvent",
        ),
    ]


class Operator(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    schema_version: Literal["sprisk.operator/v1"]
    id: OperatorRef
    capability_class: CapabilityClass
    model: OperatorModel | None = None
    description: str | None = None
    entrypoint: Annotated[
        Entrypoint, Field(description="Python `module:function` the worker calls.")
    ]
    inputs: list[Port]
    outputs: list[Port]
    params_schema: Annotated[
        dict[str, Any],
        Field(
            description="JSON Schema for this operator's params. The compiler validates node params against it."
        ),
    ]
    effects: Effects
    network: NetworkAccess
    resources: Resources


class PipelineVersion(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    schema_version: Literal["sprisk.pipeline_version/v1"]
    id: PipelineVersionId
    project_id: ProjectId
    question_version_id: Annotated[
        QuestionVersionId | None,
        Field(
            description="Exact immutable question-ledger revision this flow answers. Absent only for legacy or not-yet-scoped flows."
        ),
    ] = None
    parent_id: Annotated[
        PipelineVersionId | None,
        Field(description="Version this one was derived from. Absent for the first version."),
    ] = None
    compares: Annotated[
        MethodologyProposalId | None,
        Field(
            description="The shortlist proposal whose models this version cross-validates (ADR-0046). A comparison is a side version, not an edit: it has no parent_id, so the proposal stays applicable. Absent on every other version."
        ),
    ] = None
    nodes: list[Node]
    edges: list[Edge]
    created_at: Timestamp


class QuestionVersion(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    schema_version: Literal["sprisk.question_version/v1"]
    id: QuestionVersionId
    investigation_id: InvestigationId
    parent_id: Annotated[
        QuestionVersionId | None,
        Field(description="Version this one revises. Absent for the first version."),
    ] = None
    objective: Fact
    task: TaskFact
    target: Annotated[
        Fact | None,
        Field(description="Target column. Absent when there is no legitimate supervised target."),
    ] = None
    unit_of_analysis: Fact | None = None
    entity_column: Annotated[
        Fact | None,
        Field(
            description="Column whose values identify the unit or group that must not cross an entity-aware split."
        ),
    ] = None
    time_column: Fact | None = None
    prediction_horizon: Annotated[
        Fact | None,
        Field(
            description="How far after prediction time the outcome is observed, preferably an ISO-8601 duration such as P30D."
        ),
    ] = None
    assumptions: list[Fact]
    unknowns: list[Unknown]
    acceptance_criteria: list[Fact]
    created_at: Timestamp


class SelectionDecision(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    schema_version: Literal["sprisk.selection_decision/v1"]
    metric: SelectionMetric
    folds: Annotated[
        int,
        Field(description="Number of cross-validation folds every candidate was scored on.", ge=0),
    ]
    seed: Annotated[int, Field(description="Seed that shuffled the rows into folds.", ge=0)]
    baseline: Annotated[
        str,
        Field(
            description="The candidate every other must beat: a model that ignores its features.",
            pattern="^[a-z][a-z0-9_]{0,62}$",
        ),
    ]
    candidates: list[CandidateResult]
    winner: Annotated[
        str | None,
        Field(
            description="The chosen candidate. Absent: no model beats the baseline.",
            pattern="^[a-z][a-z0-9_]{0,62}$",
        ),
    ] = None
    reason: Annotated[str, Field(min_length=1)]
    limitations: Annotated[
        list[Limitation], Field(description="What the comparison did not cover.")
    ]


class WorkerMessage(
    RootModel[
        Handshake
        | LeaseAttempt
        | Heartbeat
        | Progress
        | ArtifactManifest
        | Complete
        | Fail
        | Cancel
        | Acknowledge
    ]
):
    root: Annotated[
        Handshake
        | LeaseAttempt
        | Heartbeat
        | Progress
        | ArtifactManifest
        | Complete
        | Fail
        | Cancel
        | Acknowledge,
        Field(
            description="Local worker protocol message (arch doc §11). Tagged by `type`.",
            title="WorkerMessage",
        ),
    ]


class DatasetProfile(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    total_rows: Annotated[int, Field(ge=0)]
    total_columns: Annotated[int, Field(ge=0)]
    profiled_rows: Annotated[
        int,
        Field(
            description="Rows the profile covers: all of them, or the first 1,000,000 of a larger table.",
            ge=0,
        ),
    ]
    band_rows: Annotated[
        int,
        Field(
            description="Rows in each band of the missing-value map; the last band may hold fewer.",
            ge=0,
        ),
    ]
    columns: list[ColumnProfile]
    correlation: Correlation


class AppliedMethodologyDecision(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    decision: MethodologyDecision
    pipeline: PipelineVersion
