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


class Library(StrEnum):
    matplotlib = "matplotlib"
    plotly = "plotly"


class Format(StrEnum):
    svg = "svg"
    plotly_json = "plotly_json"


class Figure(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    library: Library
    format: Format
    title: str | None = None
    content: Annotated[str, Field(description="SVG markup, or a Plotly figure as JSON text.")]


class Kind(StrEnum):
    text = "text"
    table = "table"
    image = "image"


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


class PipelineVersionId(RootModel[str]):
    root: Annotated[str, Field(pattern="^plv_[0-9A-HJKMNP-TV-Z]{26}$")]


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


class Node(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: NodeId
    operator: OperatorRef
    params: Params


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


class FigureSet(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    items: list[Figure]


class DisplayItem(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    kind: Kind
    text: Annotated[str | None, Field(description="Present for kind text.")] = None
    table: Annotated[
        TablePage | None, Field(description="Present for kind table: the first rows only.")
    ] = None
    png_base64: Annotated[
        str | None, Field(description="Present for kind image: a PNG, base64-encoded.")
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


class MethodologyCheck(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    schema_version: Literal["sprisk.methodology_check/v1"]
    id: MethodologyCheckId
    pipeline_version_id: PipelineVersionId
    check: CheckRef
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


class Port(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    name: PortName
    kind: PortKind
    description: str | None = None


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


class Operator(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    schema_version: Literal["sprisk.operator/v1"]
    id: OperatorRef
    capability_class: CapabilityClass
    description: str | None = None
    entrypoint: Annotated[
        str,
        Field(
            description="Python `module:function` the worker calls.",
            pattern="^[a-z_][a-z0-9_]*(\\.[a-z_][a-z0-9_]*)*:[a-z_][a-z0-9_]*$",
        ),
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
    parent_id: Annotated[
        PipelineVersionId | None,
        Field(description="Version this one was derived from. Absent for the first version."),
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
    time_column: Fact | None = None
    assumptions: list[Fact]
    unknowns: list[Unknown]
    acceptance_criteria: list[Fact]
    created_at: Timestamp


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
