# Generated from contracts/schemas. Do not edit.

from __future__ import annotations

from typing import Annotated, Any, Literal
from pydantic import ConfigDict, Field, RootModel
from sprisk_contracts.base import StrictModel
from enum import StrEnum


class Bundle(RootModel[Any]):
    root: Annotated[Any, Field(title="Bundle")]


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
            pattern="^\\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])T([01]\\d|2[0-3]):[0-5]\\d:[0-5]\\dZ$",
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
            pattern="^[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)+@(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)$",
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
    lease_expires_at: Timestamp


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
