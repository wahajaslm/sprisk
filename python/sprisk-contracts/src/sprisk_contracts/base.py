from typing import Any

from pydantic import (
    BaseModel,
    ConfigDict,
    SerializerFunctionWrapHandler,
    model_serializer,
    model_validator,
)


class StrictModel(BaseModel):
    """Base for generated wire models.

    Strict mode stops Pydantic coercing input ("5" -> 5, epoch -> datetime),
    so Python rejects exactly what Rust and TypeScript reject.
    Serializing by alias keeps wire names for fields that clash with
    Python keywords (`from` is generated as `from_`).
    No schema field is nullable: an absent optional field is omitted, never null.
    """

    model_config = ConfigDict(strict=True, serialize_by_alias=True)

    @model_validator(mode="before")
    @classmethod
    def _reject_null(cls, data: Any) -> Any:
        path = find_null(data, "$")
        if path:
            raise ValueError(f"null is not allowed; omit the field instead (at {path})")
        return data

    @model_serializer(mode="wrap")
    def _omit_absent(self, handler: SerializerFunctionWrapHandler) -> Any:
        data = handler(self)
        if isinstance(data, dict):
            return {k: v for k, v in data.items() if v is not None}
        return data


def find_null(value: Any, path: str) -> str | None:
    """Path of the first JSON null in value, or None. Null is never valid wire data."""
    if value is None:
        return path
    if isinstance(value, list):
        return next((p for i, v in enumerate(value) if (p := find_null(v, f"{path}[{i}]"))), None)
    if isinstance(value, dict):
        return next((p for k, v in value.items() if (p := find_null(v, f"{path}.{k}"))), None)
    return None
