from pathlib import Path

import numpy as np
import polars as pl
import pytest
from asset_files import tiny_clip, write_image

from sprisk_clean import embed_images as module


def test_embed_images_appends_one_unit_vector_per_found_image(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(module, "load_clip", tiny_clip)
    write_image(tmp_path / "image_1_product_10.jpg", (200, 10, 10))
    write_image(tmp_path / "image_2_product_20.jpg", (10, 10, 200))
    (tmp_path / "image_3_product_30.jpg").write_bytes(b"not an image")
    train = pl.DataFrame({"imageid": [1, 2], "productid": [10, 20]})
    test = pl.DataFrame({"imageid": [3, 4], "productid": [30, 40]})

    result = module.embed_images(train, test, tmp_path, "imageid", "productid", batch_size=1)

    matrix, names = result["train_words"]
    assert matrix.shape == (2, 8)
    assert names == tuple(f"image_clip_{i:03d}" for i in range(8))
    assert np.allclose(np.linalg.norm(matrix.toarray(), axis=1), 1.0)
    assert result["test_words"][0].nnz == 0
    evidence = result["evidence"]["images.embedding_coverage"]
    assert evidence["dimensions"] == 8
    assert evidence["test"] == {"rows": 2, "found": 0, "missing": 1, "unreadable": 1}
