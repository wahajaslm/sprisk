"""The decorator-written split must behave exactly like today's split. Today's code and YAML
are the oracle; every difference is listed in DIFFERENCES and asserted, not hidden."""

import importlib.util
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import polars as pl
import pytest
import yaml
from polars.testing import assert_frame_equal

import validation
from split_method import split_method
from sprisk import (
    choose,
    decide,
    evidence_manifest,
    method,
    method_manifest,
    notebook_cell,
    operator_manifest,
)
from sprisk_validation import group_split as old_group
from sprisk_validation import random_split as old_random
from sprisk_validation import split_evidence as old_evidence
from sprisk_validation import temporal_split as old_temporal
from validation import group_split, random_split, stratified_split, temporal_split
from validation.group_split import group_overlap, no_group_overlap
from validation.row_overlap import no_row_in_both, row_overlap

# Aliased: pytest would collect a name starting with test_ as a test.
from validation.temporal_split import test_after_train as promise_test_after_train
from validation.temporal_split import time_order

REPO = Path(__file__).parents[2]
OPERATORS = REPO / "plugins" / "validation" / "operators"
OLD_METHOD_DIR = REPO / "methodology" / "supervised" / "methods" / "split_method"


def _old_method() -> Any:
    spec = importlib.util.spec_from_file_location("old_split", OLD_METHOD_DIR / "method.py")
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


OLD = _old_method()
OLD_YAML = yaml.safe_load((OLD_METHOD_DIR / "method.yaml").read_text())


def _old_manifest(name: str) -> dict[str, Any]:
    return yaml.safe_load((OPERATORS / name / "manifest.yaml").read_text())


@pytest.fixture
def rows() -> pl.DataFrame:
    n = 40
    return pl.DataFrame(
        {
            "title_id": [f"item{i // 2}" for i in range(n)],
            "day": list(range(n)),
            "kind": ["a", "b"] * (n // 2),
            "price": [float(i % 7) for i in range(n)],
        }
    )


CASES = [
    ("classification", {"common.event_time", "common.item_identity", "common.target"}),
    ("classification", {"common.item_identity", "common.target"}),
    ("classification", {"common.target"}),
    ("classification", set()),
    ("regression", {"common.target"}),
]


@pytest.mark.parametrize(("task", "bound"), CASES)
def test_the_method_picks_todays_option_and_reason(task: str, bound: set[str]) -> None:
    ctx = SimpleNamespace(task=task, bound=lambda concept: concept in bound)
    old_option, old_reason = OLD._preferred(ctx)

    new = decide(
        split_method,
        task=task,
        event_time="day" if "common.event_time" in bound else None,
        item_identity="title_id" if "common.item_identity" in bound else None,
        target="kind" if "common.target" in bound else None,
    )

    assert (new.option, new.reason) == (old_option, old_reason)


def test_a_method_cannot_choose_an_option_it_did_not_declare() -> None:
    @method(options={"only": random_split})
    def broken() -> Any:
        return choose("other", "typo")

    with pytest.raises(ValueError, match="'other', which is not one of its options"):
        decide(broken)


def test_each_operator_splits_exactly_as_today(rows: pl.DataFrame) -> None:
    pairs = [
        (
            old_random.random_split(rows, test_fraction=0.2, seed=7),
            random_split(rows, test_fraction=0.2, seed=7),
        ),
        (
            old_random.random_split(rows, test_fraction=0.2, seed=7, stratify="kind"),
            stratified_split(rows, stratify="kind", test_fraction=0.2, seed=7),
        ),
        (
            old_group.group_split(rows, group_column="title_id", test_fraction=0.25, seed=3),
            group_split(rows, group_column="title_id", test_fraction=0.25, seed=3),
        ),
        (
            old_temporal.temporal_split(
                rows, time_column="day", test_fraction=0.2, group_column="title_id"
            ),
            temporal_split(rows, time_column="day", test_fraction=0.2, group_column="title_id"),
        ),
    ]
    for old, (train, test) in pairs:
        assert_frame_equal(old["train"], train)
        assert_frame_equal(old["test"], test)


def test_evidence_and_promises_judge_exactly_as_today(rows: pl.DataFrame) -> None:
    clean = group_split(rows, group_column="title_id", test_fraction=0.25, seed=3)
    leaky = random_split(rows, test_fraction=0.25, seed=3)
    for train, test in (clean, leaky):
        old = old_evidence.group_overlap(train, test, "title_id")["evaluation.group_overlap"]
        new = group_overlap(train, test, group_column="title_id")
        assert new == old
        assert no_group_overlap(new) == OLD.verify_no_group_overlap(old, {})

        old = old_evidence.row_overlap(train, test, "kind")["evaluation.row_overlap"]
        new = row_overlap(train, test, target="kind")
        assert new == old
        assert no_row_in_both(new) == OLD.verify_no_row_in_both(old, {})

        old = old_evidence.time_order(train, test, "day")["evaluation.time_order"]
        new = time_order(train, test, time_column="day")
        assert new == old
        assert promise_test_after_train(new) == OLD.verify_test_after_train(old, {})
    assert no_group_overlap(group_overlap(*leaky, group_column="title_id"))[0] == "fail"


# Every way the generated method differs from today's method.yaml.
DIFFERENCES = {
    # The label is the operator's title; the method's reason says why in its own words.
    "labels": {
        "temporal": ("Train on earlier rows, test on later ones", "Temporal split"),
        "item_groups": ("Keep each item's rows on one side", "Group split"),
        "stratified_random": ("Random rows, with class shares kept", "Stratified split"),
        "simple_random": ("Random rows", "Random split"),
    },
    # Stratifying became its own operator instead of a setting on random_split.
    "stratified_operator": (
        "sprisk.validation.random_split@1.0.0",
        "sprisk.validation.stratified_split@1.0.0",
    ),
}


def test_the_generated_method_matches_todays_yaml_except_the_listed_differences() -> None:
    new = method_manifest(split_method, "methodology.supervised", validation.PACK, "1.0.0")
    old = OLD_YAML

    for key in ("schema_version", "id", "decides", "name", "activity", "question"):
        assert new[key] == old[key], key
    assert new["applies_when"] == old["applies_when"]
    assert new["source"] == old["source"]
    assert set(new["needs"]["concepts"]) == set(old["needs"]["concepts"])
    assert new["needs"]["decisions"] == old["needs"]["decisions"]
    assert new["verifications"] == old["verifications"]

    assert [o["id"] for o in new["options"]] == [o["id"] for o in old["options"]]
    for new_option, old_option in zip(new["options"], old["options"], strict=True):
        option = old_option["id"]
        assert new_option["verify"] == old_option["verify"], option
        assert (old_option["label"], new_option["label"]) == DIFFERENCES["labels"][option]
        new_replace, old_replace = new_option["action"]["replace"], old_option["action"]["replace"]
        assert new_replace.get("concepts") == old_replace.get("concepts"), option
        assert new_replace["settings"] == old_replace["settings"], option
        assert new_replace["role"] == old_replace["role"]
        if option == "stratified_random":
            pair = (old_replace["operator"], new_replace["operator"])
            assert pair == DIFFERENCES["stratified_operator"]
        else:
            assert new_replace["operator"] == old_replace["operator"], option


SAME_OPERATOR_KEYS = (
    "schema_version", "id", "title", "capability_class", "role", "folds", "description",
    "inputs", "outputs", "effects", "network", "resources",
)  # fmt: skip


@pytest.mark.parametrize("op", [group_split, temporal_split, random_split])
def test_generated_operator_manifests_match_todays(op: Any) -> None:
    new = operator_manifest(op, validation.PACK, validation.VERSION)
    old = _old_manifest(op.__name__)

    for key in SAME_OPERATOR_KEYS:
        assert new[key] == old[key], key
    assert new.get("role_default") == old.get("role_default")
    old_props, new_props = old["params_schema"]["properties"], new["params_schema"]["properties"]
    # Today random_split also stratifies; that is now stratified_split.
    assert set(new_props) == set(old_props) - {"stratify"}
    for name, prop in new_props.items():
        assert prop["type"] == old_props[name]["type"], name


@pytest.mark.parametrize(
    ("fn", "role"), [(group_overlap, "split"), (row_overlap, "split"), (time_order, "split")]
)
def test_generated_evidence_manifests_match_todays(fn: Any, role: str) -> None:
    new = evidence_manifest(fn, validation.PACK, validation.VERSION, role)
    old = _old_manifest(fn.__name__)

    for key in ("id", "title", "capability_class", "attach", "concepts", "produces"):
        assert new[key] == old[key], key
    for key in ("inputs", "outputs", "effects", "network", "resources"):
        assert new[key] == old[key], key
    for name, prop in new["params_schema"]["properties"].items():
        old_prop = old["params_schema"]["properties"][name]
        for flag in ("x-sprisk-column", "x-sprisk-excluded"):
            assert prop.get(flag) == old_prop.get(flag), (name, flag)


def test_an_operator_whose_inputs_do_not_match_its_tables_is_refused() -> None:
    random_split.__sprisk__ = {**random_split.__sprisk__, "inputs": ["rows"]}
    try:
        with pytest.raises(ValueError, match=r"declares inputs \['rows'\] but takes tables"):
            operator_manifest(random_split, validation.PACK, validation.VERSION)
    finally:
        random_split.__sprisk__ = {**random_split.__sprisk__, "inputs": ["data"]}


@pytest.mark.parametrize(
    ("op", "settings"),
    [
        (group_split, {"group_column": "title_id", "test_fraction": 0.25, "seed": 3}),
        (temporal_split, {"time_column": "day", "test_fraction": 0.2}),
        (stratified_split, {"stratify": "kind", "test_fraction": 0.2, "seed": 7}),
        (random_split, {"test_fraction": 0.2, "seed": 7}),
    ],
)
def test_the_notebook_cell_is_plain_python_that_splits_like_the_step(
    op: Any, settings: dict[str, Any], rows: pl.DataFrame
) -> None:
    cell = notebook_cell(op, settings)
    assert "sprisk" not in cell and "@operator" not in cell

    scope: dict[str, Any] = {"data": rows}
    exec(compile(cell, "<cell>", "exec"), scope)

    train, test = op(rows, **settings)
    assert_frame_equal(scope["train"], train)
    assert_frame_equal(scope["test"], test)
