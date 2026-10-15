# Generated from contracts/schemas. Do not edit.

from __future__ import annotations

from typing import Annotated, Any, Literal
from pydantic import ConfigDict, Field, RootModel
from sprisk_contracts.base import StrictModel


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
