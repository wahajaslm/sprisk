from pydantic import BaseModel, ConfigDict


class StrictModel(BaseModel):
    """Base for generated wire models.

    Strict mode stops Pydantic coercing input ("5" -> 5, epoch -> datetime),
    so Python rejects exactly what Rust and TypeScript reject.
    Serializing by alias keeps wire names for fields that clash with
    Python keywords (`from` is generated as `from_`).
    """

    model_config = ConfigDict(strict=True, serialize_by_alias=True)
