"""Frozen visual features, aligned to the rows that already carry the objective's labels.

The encoder is never fitted on dataset rows: CLIP weights are a fixed, locally cached model.
The only learned feature representation in this step is therefore external and versioned by its
model name. Missing and unreadable files become all-zero rows and are counted in evidence.
"""

from pathlib import Path
from typing import Any

import numpy as np
import polars as pl
from PIL import Image, UnidentifiedImageError

from .row_assets import append_features, asset_root, confined_path, identifier

# torch and transformers load in the step, not at import: the worker imports every step's
# module at start, and torch alone takes seconds.
VISION_MISSING = "embed_images needs the vision extra: install sprisk-clean[vision]"

MODEL = "openai/clip-vit-base-patch32"
# A model name alone can move; the commit fixes which weights produced the features.
REVISION = "3d74acf9a28c67741b2f4f2ea7635f0aaf6f0268"


def embed_images(
    train: pl.DataFrame,
    test: pl.DataFrame,
    image_dir: Path,
    image_id_column: str,
    product_id_column: str,
    batch_size: int = 64,
    train_words: tuple[Any, tuple[str, ...]] | None = None,
    test_words: tuple[Any, tuple[str, ...]] | None = None,
) -> dict[str, Any]:
    """Append frozen CLIP image features to an optional text matrix.

    Rakuten names each file ``image_{imageid}_product_{productid}.jpg``. Matching uses both
    identifiers, so an image cannot silently attach to a different product. The model is loaded
    with ``local_files_only``: pipeline execution never downloads weights or touches a network.
    """
    root = asset_root(image_dir, "image_dir")
    for rows, name in ((train, "train"), (test, "test")):
        for column in (image_id_column, product_id_column):
            if column not in rows.columns:
                raise ValueError(f"{column!r} is not a column of the {name} rows")
    if batch_size < 1:
        raise ValueError("batch_size must be at least 1")
    processor, model = load_clip()
    train_values, train_state = _encode(
        train, root, image_id_column, product_id_column, batch_size, processor, model
    )
    test_values, test_state = _encode(
        test, root, image_id_column, product_id_column, batch_size, processor, model
    )
    names = tuple(f"image_clip_{i:03d}" for i in range(train_values.shape[1]))
    train_matrix, train_names = append_features(train_values, names, train_words)
    test_matrix, test_names = append_features(test_values, names, test_words)
    if train_names != test_names:
        raise ValueError("train and test image features differ")
    return {
        "train": train,
        "test": test,
        "train_words": (train_matrix, train_names),
        "test_words": (test_matrix, test_names),
        "evidence": {
            "images.embedding_coverage": {
                "model": MODEL,
                "revision": REVISION,
                "dimensions": train_values.shape[1],
                "train": train_state,
                "test": test_state,
            }
        },
    }


def load_clip() -> tuple[Any, Any]:
    try:
        from transformers import CLIPImageProcessor, CLIPModel
    except ImportError as error:
        raise ImportError(VISION_MISSING) from error
    processor = CLIPImageProcessor.from_pretrained(MODEL, revision=REVISION, local_files_only=True)
    model: Any = CLIPModel.from_pretrained(
        MODEL, revision=REVISION, local_files_only=True, use_safetensors=True
    )
    return processor, model.eval()


def _encode(
    rows: pl.DataFrame,
    root: Path,
    image_id: str,
    product_id: str,
    batch_size: int,
    processor: Any,
    model: Any,
) -> tuple[np.ndarray, dict[str, int]]:
    try:
        import torch
    except ImportError as error:
        raise ImportError(VISION_MISSING) from error
    out = np.zeros((rows.height, model.config.projection_dim), dtype=np.float32)
    state = {"rows": rows.height, "found": 0, "missing": 0, "unreadable": 0}
    paths: list[tuple[int, Path]] = []
    for index, (image, product) in enumerate(
        zip(rows[image_id].to_list(), rows[product_id].to_list(), strict=True)
    ):
        path = confined_path(root, f"image_{identifier(image)}_product_{identifier(product)}.jpg")
        if path is None or not path.is_file():
            state["missing"] += 1
        else:
            paths.append((index, path))
    # Decoded a batch at a time, so memory holds one batch of pixels, not the whole set.
    for start in range(0, len(paths), batch_size):
        batch: list[tuple[int, Image.Image]] = []
        for index, path in paths[start : start + batch_size]:
            try:
                with Image.open(path) as opened:
                    batch.append((index, opened.convert("RGB")))
            except (OSError, UnidentifiedImageError):
                state["unreadable"] += 1
        if not batch:
            continue
        state["found"] += len(batch)
        inputs = processor(images=[image for _, image in batch], return_tensors="pt")
        with torch.inference_mode():
            values = model.get_image_features(**inputs).pooler_output
            values = (
                torch.nn.functional.normalize(values, p=2, dim=1).cpu().numpy().astype(np.float32)
            )
        for (index, _), value in zip(batch, values, strict=True):
            out[index] = value
    return out, state
