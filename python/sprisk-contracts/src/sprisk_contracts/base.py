from pydantic import BaseModel, ConfigDict


class StrictModel(BaseModel):
    """Base for generated wire models.

    Strict mode stops Pydantic coercing input ("5" -> 5, epoch -> datetime),
    so Python rejects exactly what Rust and TypeScript reject.
    """

    model_config = ConfigDict(strict=True)
