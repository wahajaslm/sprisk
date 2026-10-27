from pathlib import Path

import polars as pl
from PIL import Image

from sprisk_clean.audit_images import KIND, audit_images


def _write(root: Path, image_id: int, product_id: int, colour: tuple[int, int, int]) -> None:
    Image.new("RGB", (20, 10), colour).save(root / f"image_{image_id}_product_{product_id}.jpg")


def test_audit_images_reports_linked_assets_and_candidates(tmp_path: Path) -> None:
    _write(tmp_path, 1, 10, (255, 255, 255))
    _write(tmp_path, 2, 20, (255, 255, 255))
    (tmp_path / "image_3_product_30.jpg").write_bytes(b"not an image")
    data = pl.DataFrame({"imageid": [1, 2, 3, 4], "productid": [10, 20, 30, 40]})

    report = audit_images(data, tmp_path, "image_{imageid}_product_{productid}.jpg")[KIND]

    assert report["rows"] == 4
    assert report["found"] == 2
    assert report["missing"] == 1
    assert report["unreadable"] == 1
    assert report["coverage"] == 0.5
    assert report["width"] == {"min": 20.0, "median": 20.0, "max": 20.0}
    assert report["height"] == {"min": 10.0, "median": 10.0, "max": 10.0}
    assert report["aspect_ratio"] == {"min": 2.0, "median": 2.0, "max": 2.0}
    assert report["perceptual_duplicate_candidates"] == {"groups": 1, "images_in_groups": 2}


def test_audit_images_never_reads_a_file_outside_the_image_dir(tmp_path: Path) -> None:
    root = tmp_path / "images"
    (root / "image_x").mkdir(parents=True)
    Image.new("RGB", (4, 4)).save(tmp_path / "secret_product_1.jpg")
    data = pl.DataFrame({"imageid": ["x/../../secret"], "productid": [1]})

    report = audit_images(data, root, "image_{imageid}_product_{productid}.jpg")[KIND]

    assert (report["found"], report["missing"]) == (0, 1)
