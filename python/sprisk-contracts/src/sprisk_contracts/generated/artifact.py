# Generated from contracts/schemas. Do not edit.

from __future__ import annotations

from typing import Annotated, Literal
from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, RootModel


class ArtifactId(RootModel[str]):
    root: Annotated[str, Field(pattern="^art_[0-9A-HJKMNP-TV-Z]{26}$")]


class ProjectId(RootModel[str]):
    root: Annotated[str, Field(pattern="^prj_[0-9A-HJKMNP-TV-Z]{26}$")]


class StepAttemptId(RootModel[str]):
    root: Annotated[str, Field(pattern="^att_[0-9A-HJKMNP-TV-Z]{26}$")]


class SchemaId(RootModel[str]):
    root: Annotated[str, Field(pattern="^sch_[0-9A-HJKMNP-TV-Z]{26}$")]


class ContentHash(RootModel[str]):
    root: Annotated[str, Field(pattern="^sha256:[0-9a-f]{64}$")]


class Artifact(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    schema_version: Literal["sprisk.artifact/v1"]
    id: ArtifactId
    project_id: ProjectId
    producer_attempt_id: StepAttemptId
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
    created_at: AwareDatetime
