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
        extra="forbid",
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
