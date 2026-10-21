import polars as pl
import pytest

from sprisk_validation.random_split import as_code, random_split

IDS = pl.DataFrame({"id": list(range(100))})


def test_random_split_partitions_rows_by_fraction() -> None:
    out = random_split(IDS, test_fraction=0.2, seed=7)
    assert out["test"].height == 20
    assert sorted(out["train"]["id"].to_list() + out["test"]["id"].to_list()) == list(range(100))


def test_random_split_is_reproducible_by_seed() -> None:
    a = random_split(IDS, test_fraction=0.2, seed=7)["test"]
    b = random_split(IDS, test_fraction=0.2, seed=7)["test"]
    assert a["id"].to_list() == b["id"].to_list()


def test_random_split_that_leaves_test_empty_is_an_error() -> None:
    with pytest.raises(ValueError, match="1 train and 0 test rows"):
        random_split(pl.DataFrame({"id": [1]}), test_fraction=0.1, seed=1)


def test_stratified_split_keeps_each_class_share_in_test() -> None:
    data = pl.DataFrame({"id": list(range(100)), "y": ["a"] * 80 + ["b"] * 20})
    test = random_split(data, test_fraction=0.25, seed=3, stratify="y")["test"]
    counts = dict(test.group_by("y").len().iter_rows())
    assert counts == {"a": 20, "b": 5}


def test_stratify_on_a_column_with_missing_values_is_an_error() -> None:
    data = pl.DataFrame({"id": [1, 2, 3, 4], "y": ["a", None, "a", "b"]})
    with pytest.raises(ValueError, match="y has 1 missing"):
        random_split(data, test_fraction=0.5, seed=1, stratify="y")


@pytest.mark.parametrize("stratify", [None, "y"])
def test_plain_code_splits_the_rows_as_the_step_does(stratify: str | None) -> None:
    data = pl.DataFrame({"id": list(range(100)), "y": ["a"] * 80 + ["b"] * 20})
    settings: dict[str, object] = {"test_fraction": 0.25, "seed": 3}
    if stratify:
        settings["stratify"] = stratify
    code = as_code(settings, {"data": "rows"}, {"train": "fit_rows", "test": "held_out"})
    namespace: dict[str, object] = {"rows": data}
    exec(code, namespace)
    step = random_split(data, **settings)  # type: ignore[arg-type]
    assert namespace["fit_rows"].equals(step["train"])  # type: ignore[attr-defined]
    assert namespace["held_out"].equals(step["test"])  # type: ignore[attr-defined]
