"""Frozen visual features, aligned to the rows that already carry the objective's labels.

The encoder is never fitted on dataset rows: CLIP weights are a fixed, locally cached model.
The only learned feature representation in this step is therefore external and versioned by its
model name. Missing and unreadable files become all-zero rows and are counted in evidence.
"""

from pathlib import Path
from typing import Any

import numpy as np
import polars as pl
import torch
from PIL import Image, UnidentifiedImageError
from scipy import sparse
from transformers import CLIPModel, CLIPProcessor

DEFAULT_MODEL = "openai/clip-vit-base-patch32"


def embed_images(
    train: pl.DataFrame,
    test: pl.DataFrame,
    image_dir: str,
    image_id_column: str,
    product_id_column: str,
    batch_size: int = 64,
    train_words: tuple[Any, tuple[str, ...]] | None = None,
    test_words: tuple[Any, tuple[str, ...]] | None = None,
) -> dict[str, Any]:
    """Append 512 frozen CLIP image features to an optional text matrix.

    Rakuten names each file ``image_{imageid}_product_{productid}.jpg``. Matching uses both
    identifiers, so an image cannot silently attach to a different product. The model is loaded
    with ``local_files_only``: pipeline execution never downloads weights or touches a network.
    """
    root = Path(image_dir)
    if not root.is_dir():
        raise ValueError(f"image_dir is not a directory: {image_dir}")
    for rows, name in ((train, "train"), (test, "test")):
        for column in (image_id_column, product_id_column):
            if column not in rows.columns:
                raise ValueError(f"{column!r} is not a column of the {name} rows")
    if batch_size < 1:
        raise ValueError("batch_size must be at least 1")
    processor = CLIPProcessor.from_pretrained(DEFAULT_MODEL, local_files_only=True)
    model = CLIPModel.from_pretrained(DEFAULT_MODEL, local_files_only=True).eval()
    train_values, train_state = _encode(train, root, image_id_column, product_id_column, batch_size, processor, model)
    test_values, test_state = _encode(test, root, image_id_column, product_id_column, batch_size, processor, model)
    names = tuple(f"image_clip_{i:03d}" for i in range(train_values.shape[1]))
    train_matrix, train_names = _append(train_values, names, train_words)
    test_matrix, test_names = _append(test_values, names, test_words)
    if train_names != test_names:
        raise ValueError("train and test image features differ")
    return {
        "train": train,
        "test": test,
        "train_words": (train_matrix, train_names),
        "test_words": (test_matrix, test_names),
        "evidence": {
            "images.embedding_coverage": {
                "model": DEFAULT_MODEL,
                "dimensions": train_values.shape[1],
                "train": train_state,
                "test": test_state,
            }
        },
    }


def _encode(rows: pl.DataFrame, root: Path, image_id: str, product_id: str, batch_size: int, processor: Any, model: Any) -> tuple[np.ndarray, dict[str, int]]:
    out = np.zeros((rows.height, 512), dtype=np.float32)
    found: list[tuple[int, Image.Image]] = []
    state = {"rows": rows.height, "found": 0, "missing": 0, "unreadable": 0}
    for index, (image, product) in enumerate(zip(rows[image_id].to_list(), rows[product_id].to_list(), strict=True)):
        path = root / f"image_{_identifier(image)}_product_{_identifier(product)}.jpg"
        if not path.is_file():
            state["missing"] += 1
            continue
        try:
            with Image.open(path) as opened:
                found.append((index, opened.convert("RGB").copy()))
        except (OSError, UnidentifiedImageError):
            state["unreadable"] += 1
    state["found"] = len(found)
    for start in range(0, len(found), batch_size):
        batch = found[start : start + batch_size]
        inputs = processor(images=[image for _, image in batch], return_tensors="pt")
        with torch.inference_mode():
            values = model.get_image_features(**inputs)
            # Transformers 5 returns a model-output wrapper here; older releases returned the
            # tensor directly. The pooled embedding is the same frozen visual representation.
            if hasattr(values, "pooler_output"):
                values = values.pooler_output
            values = torch.nn.functional.normalize(values, p=2, dim=1).cpu().numpy().astype(np.float32)
        for (index, _), value in zip(batch, values, strict=True):
            out[index] = value
    return out, state


def _identifier(value: object) -> str:
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)


def _append(values: np.ndarray, names: tuple[str, ...], existing: tuple[Any, tuple[str, ...]] | None) -> tuple[sparse.csr_matrix, tuple[str, ...]]:
    visual = sparse.csr_matrix(values)
    if existing is None:
        return visual, names
    matrix, previous = existing
    return sparse.hstack([matrix, visual], format="csr"), tuple(previous) + names
