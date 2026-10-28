from typing import Any

import pytest

from sprisk_contracts import NotebookCodeRequest, NotebookSettingsRequest
from sprisk_ml.models import dummy_baseline_as_code, random_forest_as_code
from sprisk_validation.stratified_split import stratified_split
from sprisk_workers.errors import ManifestError
from sprisk_workers.notebook_code import read_code, read_settings, source_cell, write_code

REQUEST = NotebookCodeRequest.model_validate_json(
    '{"settings": {"test_fraction": 0.25, "seed": 42, "stratify": "credit_risk"},'
    ' "inputs": {"data": "load_data"}, "outputs": {"train": "split_train", "test": "split_test"}}'
)


def test_a_step_is_written_as_plain_python_with_its_settings_and_names() -> None:
    code = write_code("sprisk_validation.stratified_split:stratified_split", REQUEST).code
    assert "from sklearn.model_selection import train_test_split" in code
    assert "@operator" not in code and "sprisk" not in code
    assert code.rstrip().endswith(
        "split_train, split_test = stratified_split("
        "load_data, stratify='credit_risk', test_fraction=0.25, seed=42)"
    )


def test_a_writer_outside_the_core_packs_is_refused() -> None:
    with pytest.raises(ManifestError, match="not in a trusted core pack"):
        write_code("os:getcwd", REQUEST)


SPLIT = {"test_fraction": 0.25, "seed": 42, "stratify": "credit_risk"}
SPLIT_NAMES = ({"data": "df"}, {"train": "train", "test": "test"})
FOREST = {"target": "y", "task": "classification", "n_estimators": 200, "seed": 0}
FOREST_NAMES = ({"train": "train"}, {"model": "model"})


SPLIT_CELL = source_cell(stratified_split)


def split_code(settings: dict[str, Any]) -> str:
    return SPLIT_CELL(settings, *SPLIT_NAMES)


def read_split(code: str) -> dict[str, Any] | None:
    return read_settings(SPLIT_CELL, SPLIT, *SPLIT_NAMES, code)


def read_forest(code: str, settings: dict[str, Any] = FOREST) -> dict[str, Any] | None:
    return read_settings(random_forest_as_code, settings, *FOREST_NAMES, code)


def forest_code(settings: dict[str, Any]) -> str:
    return random_forest_as_code(settings, *FOREST_NAMES)


def test_changed_values_are_read_back_as_the_steps_settings() -> None:
    edited = split_code(SPLIT).replace("test_fraction=0.25", "test_fraction=0.3")
    edited = edited.replace("seed=42", "seed=7")
    assert read_split(edited) == {**SPLIT, "test_fraction": 0.3, "seed": 7}


def test_a_changed_text_value_is_read_back() -> None:
    edited = split_code(SPLIT).replace("'credit_risk'", "'housing'")
    assert read_split(edited) == {**SPLIT, "stratify": "housing"}


def test_a_list_setting_may_grow() -> None:
    settings = {**FOREST, "features": ["a", "b"]}
    edited = forest_code(settings).replace("['a', 'b']", "['a', 'b', 'c']")
    assert read_forest(edited, settings) == {**settings, "features": ["a", "b", "c"]}


def test_comments_and_layout_alone_change_nothing() -> None:
    edited = "# My split\n" + split_code(SPLIT).replace(
        "train_rows, test_rows", "train_rows,test_rows"
    )
    assert read_split(edited) == SPLIT


def test_new_code_is_not_settings() -> None:
    assert read_split(split_code(SPLIT) + "print(train.height)\n") is None


def test_a_value_changed_in_only_one_of_its_places_is_not_settings() -> None:
    # The target appears twice in the forest's fit: once to drop it, once as y.
    code = forest_code(FOREST)
    assert code.count("'y'") == 2
    assert read_forest(code.replace("'y'", "'z'", 1)) is None
    assert read_forest(code.replace("'y'", "'z'")) == {**FOREST, "target": "z"}


def test_a_value_the_code_computes_from_settings_is_not_a_setting() -> None:
    # The baseline's cut-off is computed from both costs, so it cannot be edited as one.
    costs = {"positive": "bad", "false_negative": 5.0, "false_positive": 1.0}
    settings = {"target": "y", "task": "classification", "costs": costs}
    names = ({"train": "train"}, {"model": "model"})
    code = dummy_baseline_as_code(settings, *names)
    assert "threshold=0.16666666666666666" in code
    edited = code.replace("threshold=0.16666666666666666", "threshold=0.5")
    assert read_settings(dummy_baseline_as_code, settings, *names, edited) is None


def test_an_expression_where_a_value_was_is_not_settings() -> None:
    assert (
        read_split(split_code(SPLIT).replace("test_fraction=0.25", "test_fraction=1 / 3")) is None
    )


def test_code_that_does_not_parse_is_not_settings() -> None:
    assert read_split(split_code(SPLIT) + "def (\n") is None


@pytest.mark.parametrize(
    "value",
    ["{[1]}", "-" * 100_000 + "1", "1" + "+1" * 100_000],
    ids=["unhashable", "out-of-memory", "too-deep"],
)
def test_a_value_that_cannot_be_read_is_code(value: str) -> None:
    # Edited code is untrusted text: anything literal_eval or the parser refuses is code.
    assert read_split(split_code(SPLIT).replace("seed=42", f"seed={value}")) is None


def test_an_edited_cell_reads_as_settings_or_as_code() -> None:
    edited = NotebookSettingsRequest.model_validate(
        {
            "settings": SPLIT,
            "inputs": {"data": "df"},
            "outputs": {"train": "train", "test": "test"},
            "code": split_code(SPLIT).replace("seed=42", "seed=7"),
        }
    )
    entrypoint = "sprisk_validation.stratified_split:stratified_split"
    assert read_code(entrypoint, edited).model_dump() == {
        "reads_as": "settings",
        "settings": {**SPLIT, "seed": 7},
    }
    more = edited.model_copy(update={"code": edited.code + "print(1)\n"})
    assert read_code(entrypoint, more).model_dump() == {"reads_as": "code"}
