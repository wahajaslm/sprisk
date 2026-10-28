"""The decorator-written split must behave like today's split. Today's code and YAML are the
oracle; every difference is listed in DIFFERENCES and asserted, not hidden."""

import importlib.util
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import plotly.graph_objects as go
import polars as pl
import pytest
import yaml
from polars.testing import assert_frame_equal

import validation
from split_method import split
from sprisk import (
    call,
    decide,
    method,
    method_manifest,
    notebook_cell,
    operator_manifest,
    plots,
)
from sprisk_validation import group_split as old_group
from sprisk_validation import random_split as old_random
from sprisk_validation import split_evidence as old_evidence
from sprisk_validation import temporal_split as old_temporal
from validation import group_split, random_split, stratified_split, temporal_split
from validation.group_split import items_per_side, no_group_overlap
from validation.random_split import no_row_in_both, rows_per_side
from validation.stratified_split import class_shares

# Aliased: pytest would collect a name starting with test_ as a test.
from validation.temporal_split import rows_over_time
from validation.temporal_split import test_after_train as promise_test_after_train

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
def test_the_method_picks_todays_option(task: str, bound: set[str]) -> None:
    ctx = SimpleNamespace(task=task, bound=lambda column: column in bound)
    old_option, _ = OLD._preferred(ctx)

    new = decide(
        split,
        task=task,
        event_time="day" if "common.event_time" in bound else None,
        item_identity="title_id" if "common.item_identity" in bound else None,
        target="kind" if "common.target" in bound else None,
    )

    assert new.option == old_option


def test_a_method_cannot_choose_an_option_it_did_not_declare() -> None:
    @method(options={"only": random_split})
    def broken() -> Any:
        return method.choose("other", reason="typo")

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


def test_promises_give_todays_verdict(rows: pl.DataFrame) -> None:
    clean = group_split(rows, group_column="title_id", test_fraction=0.25, seed=3)
    leaky = random_split(rows, test_fraction=0.25, seed=3)
    for train, test in (clean, leaky):
        overlap = old_evidence.group_overlap(train, test, "title_id")["evaluation.group_overlap"]
        old = OLD.verify_no_group_overlap(overlap, {})[0]
        assert no_group_overlap(train, test, group_column="title_id")[0] == old

        repeats = old_evidence.row_overlap(train, test, "kind")["evaluation.row_overlap"]
        old = OLD.verify_no_row_in_both(repeats, {})[0]
        # Today the target is dropped before rows are compared; the engine still does that.
        features = [c for c in test.columns if c != "kind"]
        assert no_row_in_both(train.select(features), test.select(features))[0] == old

        order = old_evidence.time_order(train, test, "day")["evaluation.time_order"]
        old = OLD.verify_test_after_train(order, {})[0]
        assert promise_test_after_train(train, test, time_column="day")[0] == old
    assert no_group_overlap(*leaky, group_column="title_id")[0] == "fail"


def test_plots_are_the_functions_that_return_a_figure() -> None:
    assert plots(group_split) == [items_per_side]
    assert plots(temporal_split) == [rows_over_time]
    assert plots(random_split) == [rows_per_side]
    assert plots(stratified_split) == [class_shares]


def test_a_plot_runs_on_the_split_with_the_settings_it_names(rows: pl.DataFrame) -> None:
    train, test = group_split(rows, group_column="title_id", test_fraction=0.25, seed=3)
    settings = {"group_column": "title_id", "test_fraction": 0.25, "seed": 3}

    figure = call(items_per_side, train, test, settings)

    assert isinstance(figure, go.Figure)
    assert list(figure.data[0].y) == [15, 5]


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
    new = method_manifest(split, "methodology.supervised", validation.PACK, "1.0.0")
    old = OLD_YAML

    for key in ("schema_version", "id", "decides", "name", "activity", "question", "source"):
        assert new[key] == old[key], key
    assert new["applies_when"] == old["applies_when"]
    assert set(new["needs"]["concepts"]) == set(old["needs"]["concepts"])
    assert new["needs"]["decisions"] == old["needs"]["decisions"]
    # A promise now reads the split's outputs itself, so it names no evidence producer.
    assert new["verifications"] == {
        name: {"promise": v["promise"]} for name, v in old["verifications"].items()
    }

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


def test_the_manifest_lists_the_plots_with_their_titles() -> None:
    manifest = operator_manifest(group_split, validation.PACK, validation.VERSION)
    assert manifest["plots"] == [{"id": "items_per_side", "title": "Items in train and test"}]


@pytest.mark.parametrize(
    ("op", "settings"),
    [
        (group_split, {"group_column": "title_id", "test_fraction": 0.25, "seed": 3}),
        (temporal_split, {"time_column": "day", "test_fraction": 0.2}),
        (stratified_split, {"stratify": "kind", "test_fraction": 0.2, "seed": 7}),
        (random_split, {"test_fraction": 0.2, "seed": 7}),
    ],
)
def test_the_notebook_cells_are_plain_python_that_run_like_the_step(
    op: Any, settings: dict[str, Any], rows: pl.DataFrame
) -> None:
    split_cell = notebook_cell(op, ["data"], settings, result="train, test")
    (plot,) = plots(op)
    plot_settings = {k: v for k, v in settings.items() if k in plot.__code__.co_varnames}
    plot_cell = notebook_cell(plot, ["train", "test"], plot_settings, result="figure")
    for cell in (split_cell, plot_cell):
        assert "sprisk" not in cell and "@operator" not in cell and "@promise" not in cell

    scope: dict[str, Any] = {"data": rows}
    exec(compile(split_cell, "<split>", "exec"), scope)
    exec(compile(plot_cell, "<plot>", "exec"), scope)

    train, test = op(rows, **settings)
    assert_frame_equal(scope["train"], train)
    assert_frame_equal(scope["test"], test)
    assert isinstance(scope["figure"], go.Figure)
