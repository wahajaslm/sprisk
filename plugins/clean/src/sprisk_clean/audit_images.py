"""Deterministic asset audit for row-linked image datasets.

The audit reads image bytes, not labels.  It therefore runs before a split and reports only
descriptive evidence: whether every row resolves to an image, decode failures, basic geometry,
lightness and exact/perceptual duplicate candidates.  A visual model is deliberately a separate
operator; quality evidence must exist before it is selected.
"""

from __future__ import annotations

from collections import Counter
from pathlib import Path
from typing import Any

import numpy as np
import polars as pl
from PIL import Image, ImageStat, UnidentifiedImageError

KIND = "images.asset_quality"


def audit_images(
    data: pl.DataFrame,
    image_dir: str,
    image_id_column: str,
    product_id_column: str,
) -> dict[str, Any]:
    """Audit the actual Rakuten-style images linked by the two identifier columns.

    A missing or unreadable file is never silently treated as a valid image.  Duplicate
    candidates use a deterministic 8x8 grayscale average hash: equal hashes are candidates,
    rather than proof that the original pixels are identical.
    """
    root = Path(image_dir)
    if not root.is_dir():
        raise ValueError(f"image_dir is not a directory: {image_dir}")
    for column in (image_id_column, product_id_column):
        if column not in data.columns:
            raise ValueError(f"{column!r} is not a column of the data")

    widths: list[int] = []
    heights: list[int] = []
    brightness: list[float] = []
    hashes: Counter[str] = Counter()
    missing = unreadable = 0
    for image_id, product_id in zip(
        data[image_id_column].to_list(), data[product_id_column].to_list(), strict=True
    ):
        path = root / f"image_{_identifier(image_id)}_product_{_identifier(product_id)}.jpg"
        if not path.is_file():
            missing += 1
            continue
        try:
            with Image.open(path) as opened:
                rgb = opened.convert("RGB")
                width, height = rgb.size
                widths.append(width)
                heights.append(height)
                brightness.append(float(sum(ImageStat.Stat(rgb).mean) / 3.0))
                hashes[_average_hash(rgb)] += 1
        except (OSError, UnidentifiedImageError):
            unreadable += 1

    found = len(widths)
    duplicate_groups = [count for count in hashes.values() if count > 1]
    return {
        KIND: {
            "rows": data.height,
            "found": found,
            "missing": missing,
            "unreadable": unreadable,
            "coverage": _share(found, data.height),
            "width": _summary(widths),
            "height": _summary(heights),
            "aspect_ratio": _summary([w / h for w, h in zip(widths, heights, strict=True)]),
            "brightness": _summary(brightness),
            "perceptual_duplicate_candidates": {
                "groups": len(duplicate_groups),
                "images_in_groups": sum(duplicate_groups),
            },
        }
    }


def _identifier(value: object) -> str:
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)


def _average_hash(image: Image.Image) -> str:
    """A stable 64-bit dHash-like fingerprint, used solely to flag candidates."""
    tiny = image.convert("L").resize((8, 8), Image.Resampling.LANCZOS)
    values = np.asarray(tiny, dtype=np.float32)
    return "".join("1" if value >= values.mean() else "0" for value in values.ravel())


def _summary(values: list[float] | list[int]) -> dict[str, float | int] | None:
    if not values:
        return None
    array = np.asarray(values, dtype=np.float64)
    return {
        "min": float(array.min()),
        "median": float(np.median(array)),
        "max": float(array.max()),
    }


def _share(part: int, total: int) -> float:
    return 0.0 if total == 0 else part / total
