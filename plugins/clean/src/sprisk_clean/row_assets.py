"""Files linked to table rows: where they may live, and how their features join the rows."""

from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path
from typing import Any

import numpy as np
from scipy import sparse


def asset_root(directory: Path, name: str) -> Path:
    root = directory.resolve()
    if not root.is_dir():
        raise ValueError(f"{name} is not a directory: {directory}")
    return root


def confined_path(root: Path, relative: object) -> Path | None:
    """The file under ``root``, or None when the row's value would escape it."""
    candidate = (root / str(relative)).resolve()
    return candidate if candidate.is_relative_to(root) else None


def identifier(value: object) -> str:
    # Polars reads an id column with a missing value as float, so 42 arrives as 42.0.
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)


def append_features(
    values: np.ndarray, names: tuple[str, ...], existing: tuple[Any, tuple[str, ...]] | None
) -> tuple[sparse.csr_matrix, tuple[str, ...]]:
    features = sparse.csr_matrix(values)
    if existing is None:
        return features, names
    matrix, previous = existing
    return sparse.hstack([matrix, features], format="csr"), tuple(previous) + names


def summary(values: Sequence[float]) -> dict[str, float] | None:
    if not values:
        return None
    array = np.asarray(values, dtype=np.float64)
    return {"min": float(array.min()), "median": float(np.median(array)), "max": float(array.max())}


def share(part: int, total: int) -> float:
    return 0.0 if total == 0 else part / total
