import polars as pl
import pytest

from sprisk_clean.encode import as_code, encode

TRAIN = pl.DataFrame({"purpose": ["car", "tv", "car"], "age": [30, 40, 50]})
TEST = pl.DataFrame({"purpose": ["tv", "boat"], "age": [35, 45]})


def test_one_column_per_category_the_train_rows_have() -> None:
    out = encode(TRAIN, TEST, columns=["purpose"])
    assert out["train"].columns == ["age", "purpose_car", "purpose_tv"]
    assert out["train"]["purpose_car"].to_list() == [1, 0, 1]
    assert out["train"]["purpose_tv"].to_list() == [0, 1, 0]


def test_a_category_seen_only_in_test_gets_zeros() -> None:
    test = encode(TRAIN, TEST, columns=["purpose"])["test"]
    assert test.columns == ["age", "purpose_car", "purpose_tv"]
    assert test.select("purpose_car", "purpose_tv").rows() == [(0, 1), (0, 0)]


def test_a_gap_must_be_filled_first() -> None:
    gaps = pl.DataFrame({"purpose": ["car", None], "age": [1, 2]})
    with pytest.raises(ValueError, match="purpose has missing values; fill gaps before encoding"):
        encode(gaps, TEST, columns=["purpose"])


def test_a_new_column_may_not_replace_an_existing_one() -> None:
    clash = TRAIN.with_columns(pl.lit(1).alias("purpose_car"))
    with pytest.raises(ValueError, match="purpose_car is already a column"):
        encode(clash, TEST.with_columns(pl.lit(1).alias("purpose_car")), columns=["purpose"])


def test_plain_code_encodes_as_the_step_does() -> None:
    namespace: dict[str, object] = {"rows": TRAIN, "held_out": TEST}
    exec(
        as_code(
            {"columns": ["purpose"]},
            {"train": "rows", "test": "held_out"},
            {"train": "a", "test": "b"},
        ),
        namespace,
    )
    step = encode(TRAIN, TEST, columns=["purpose"])
    assert namespace["a"].equals(step["train"])  # type: ignore[attr-defined]
    assert namespace["b"].equals(step["test"])  # type: ignore[attr-defined]
