import polars as pl
import pytest

from sprisk_clean.row_assets import file_names


def test_a_pattern_names_each_row_s_file_from_its_columns() -> None:
    rows = pl.DataFrame({"imageid": [1, 2], "productid": [10.0, None]})
    # An id column with a gap is read as float: 10.0 names file 10; a gap names no file.
    assert file_names(rows, "image_{imageid}_product_{productid}.jpg") == [
        "image_1_product_10.jpg",
        None,
    ]


def test_a_pattern_naming_a_missing_column_is_refused() -> None:
    with pytest.raises(ValueError, match="'clip' is not a column"):
        file_names(pl.DataFrame({"path": ["a.wav"]}), "{clip}")
