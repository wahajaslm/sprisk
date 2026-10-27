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

from .row_assets import asset_root, confined_path, file_names, share, summary

KIND = "images.asset_quality"


def audit_images(
    data: pl.DataFrame,
    image_dir: Path,
    file_pattern: str,
) -> dict[str, Any]:
    """Audit each row's image, named by ``file_pattern`` from its columns
    (Rakuten: ``image_{imageid}_product_{productid}.jpg``).

    A missing or unreadable file is never silently treated as a valid image.  Duplicate
    candidates use a deterministic 8x8 grayscale average hash: equal hashes are candidates,
    rather than proof that the original pixels are identical.
    """
    root = asset_root(image_dir, "image_dir")

    widths: list[int] = []
    heights: list[int] = []
    brightness: list[float] = []
    hashes: Counter[str] = Counter()
    missing = unreadable = 0
    for name in file_names(data, file_pattern):
        path = confined_path(root, name)
        if path is None or not path.is_file():
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
            "coverage": share(found, data.height),
            "width": summary(widths),
            "height": summary(heights),
            "aspect_ratio": summary([w / h for w, h in zip(widths, heights, strict=True)]),
            "brightness": summary(brightness),
            "perceptual_duplicate_candidates": {
                "groups": len(duplicate_groups),
                "images_in_groups": sum(duplicate_groups),
            },
        }
    }


def _average_hash(image: Image.Image) -> str:
    """A stable 64-bit dHash-like fingerprint, used solely to flag candidates."""
    tiny = image.convert("L").resize((8, 8), Image.Resampling.LANCZOS)
    values = np.asarray(tiny, dtype=np.float32)
    return "".join("1" if value >= values.mean() else "0" for value in values.ravel())
