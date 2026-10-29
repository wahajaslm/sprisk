"""A clean-pack-shaped operator written the ADR-0071 way: every setting type the clean
operators use, ports of several kinds, and the manifest fields they carry."""

from pathlib import Path
from typing import Annotated, Any, Literal

import polars as pl

from sprisk_workers.authoring import Columns, operator


@operator(
    id="fill_gaps",
    title="Gap filling",
    stage="clean",
    inputs={"train": "table", "test": "table", "words": "matrix"},
    outputs={
        "train": "table",
        "test": "table",
        "evidence": {"kind": "report", "description": "Rows filled."},
    },
    fits_on_train=True,
    produces={"data.gaps": {"fields": {"rows": "integer"}}},
)
def fill_gaps(
    train: pl.DataFrame,
    test: pl.DataFrame,
    columns: Columns,
    method: Literal["median", "mean"],
    words: Any = None,
    text_fill: dict[str, str] | None = None,
    share: Annotated[float, {"exclusiveMinimum": 0, "maximum": 1}] = 0.5,
    keep: bool = True,
    folder: Annotated[Path, {"x-sprisk-asset-root": "audio"}] | None = None,
) -> dict[str, Any]:
    """Fill gaps with a statistic of the train rows.

    Args:
        columns: Columns whose gaps are filled.
        method: Statistic of the train rows.
    """
    filled = [pl.col(c).fill_null(0) for c in columns]
    return {
        "train": train.with_columns(filled),
        "test": test.with_columns(filled),
        "evidence": {"data.gaps": {"rows": train.height}},
    }
