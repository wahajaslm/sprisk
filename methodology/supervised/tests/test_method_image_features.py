"""Image features (ADR-0063 amendment, 27 Oct): added before the model when most rows have a
readable file, left out with the reason when too few do."""

from typing import Any

from method_harness import decide

METHOD = "supervised/image_features"
KIND = "images.asset_quality"


def audit(rows: int, found: int) -> dict[str, Any]:
    return {
        KIND: {
            "rows": rows,
            "found": found,
            "missing": rows - found,
            "unreadable": 0,
            "coverage": found / rows,
        }
    }


def test_most_rows_with_a_readable_file_add_the_features() -> None:
    d = decide(METHOD, evidence=audit(100, 85))
    assert (d["outcome"], d["option"]) == ("choose", "add_image_features")
    assert "85 of 100" in d["reason"]


def test_too_few_readable_files_leave_the_images_out_and_say_why() -> None:
    d = decide(METHOD, evidence=audit(100, 79))
    assert (d["outcome"], d["option"]) == ("choose", "leave_out_images")
    assert "79 of 100" in d["reason"]


def test_unmeasured_images_are_left_out_and_it_says_why() -> None:
    d = decide(METHOD)
    assert (d["outcome"], d["option"]) == ("choose", "leave_out_images")
    assert "not measured" in d["reason"]
