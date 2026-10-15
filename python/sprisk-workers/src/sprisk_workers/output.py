from dataclasses import dataclass
from pathlib import Path

PARQUET = "application/vnd.apache.parquet"
JSON = "application/json"
SKOPS = "application/vnd.skops"


@dataclass(frozen=True)
class Output:
    """One file an operator wrote into its staging directory, for one output port."""

    port: str
    path: Path
    media_type: str
