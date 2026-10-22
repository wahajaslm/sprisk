from dataclasses import dataclass
from pathlib import Path

PARQUET = "application/vnd.apache.parquet"
JSON = "application/json"
SKOPS = "application/vnd.skops"
# A sparse matrix and its column names, as NumPy arrays in one .npz (ADR-0058).
MATRIX = "application/vnd.sprisk.matrix+npz"

# Every step may also write this: what it printed and warned (ADR-0025).
CONSOLE_PORT = "console"


@dataclass(frozen=True)
class Output:
    """One file an operator wrote into its staging directory, for one output port."""

    port: str
    path: Path
    media_type: str
