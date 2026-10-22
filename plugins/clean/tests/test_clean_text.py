import polars as pl

from sprisk_clean.clean_text import clean_text

DATA = pl.DataFrame(
    {
        "island": ["  Biscoe ", "Dream\t\tIsland", "", None],
        "sex": ["MALE", " female", "  ", "MALE"],
        "n": [1, 2, 3, 4],
    }
)


def test_trims_and_collapses_spaces_and_blank_text_becomes_missing() -> None:
    out = clean_text(DATA, columns=["island", "sex"])
    assert out["island"].to_list() == ["Biscoe", "Dream Island", None, None]
    assert out["sex"].to_list() == ["MALE", "female", None, "MALE"]
    assert out["n"].to_list() == [1, 2, 3, 4], "other columns untouched"


def test_lowercase_on_request() -> None:
    assert clean_text(DATA, columns=["sex"], lowercase=True)["sex"].to_list() == [
        "male",
        "female",
        None,
        "male",
    ]


def test_blank_text_can_be_kept() -> None:
    assert clean_text(DATA, columns=["island"], empty_to_null=False)["island"].to_list() == [
        "Biscoe",
        "Dream Island",
        "",
        None,
    ]


def test_a_column_that_is_not_text_is_an_error() -> None:
    import pytest

    with pytest.raises(ValueError, match="n is not a text column"):
        clean_text(DATA, columns=["n"])


def test_a_column_name_that_looks_like_a_pattern_cleans_only_that_column() -> None:
    data = pl.DataFrame({"^.*$": [" A "], "other": [" B "]})
    out = clean_text(data, columns=["^.*$"])
    assert out["^.*$"].to_list() == ["A"] and out["other"].to_list() == [" B "]
