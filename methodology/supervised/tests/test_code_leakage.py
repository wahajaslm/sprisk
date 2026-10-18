from collections.abc import Sequence
from textwrap import dedent
from typing import Any

import pytest

from sprisk_contracts import MethodologyCheck, PipelineVersion
from sprisk_contracts.generated.models import Verdict
from sprisk_supervised.code_leakage import code_leakage
from sprisk_supervised.split_leakage import CheckInputError

CHECK_ID = "mck_01JABCDEFGHJKMNPQRSTVWXYZ0"
NOW = "2026-10-18T10:00:00Z"
CODE = "sprisk.code.python@2.0.0"


def step(
    node: str, source: str, inputs: Sequence[str] = (), outputs: Sequence[str] = ()
) -> dict[str, Any]:
    params = {"source": dedent(source), "inputs": list(inputs), "outputs": list(outputs)}
    return {"id": node, "operator": CODE, "params": params}


def check(*nodes: dict[str, Any], edges: Sequence[tuple[str, str]] = ()) -> MethodologyCheck:
    pipeline = PipelineVersion.model_validate(
        {
            "schema_version": "sprisk.pipeline_version/v1",
            "id": "plv_01JABCDEFGHJKMNPQRSTVWXYZ0",
            "project_id": "prj_01JABCDEFGHJKMNPQRSTVWXYZ0",
            "nodes": list(nodes),
            "edges": [{"from": a, "to": b} for a, b in edges],
            "created_at": NOW,
        }
    )
    return code_leakage(pipeline, CHECK_ID, NOW)


def test_flow_without_code_steps_is_not_assessed() -> None:
    result = check({"id": "load", "operator": "sprisk.io.file_source@1.0.0", "params": {}})
    assert result.verdict == Verdict.not_assessed
    assert result.check.root == "supervised.code_leakage@1.0.0"


def test_scaling_after_the_split_passes() -> None:
    result = check(
        step(
            "a",
            """
            from sklearn.model_selection import train_test_split
            from sklearn.preprocessing import StandardScaler
            X_train, X_test, y_train, y_test = train_test_split(X, y)
            scaler = StandardScaler().fit(X_train)
            model.fit(scaler.transform(X_train), y_train)
            """,
        )
    )
    assert result.verdict == Verdict.pass_
    assert [n.root for n in result.cited_nodes] == ["a"]


def test_scaling_all_rows_before_the_split_fails() -> None:
    result = check(
        step(
            "a",
            """
            X_scaled = StandardScaler().fit_transform(X)
            X_train, X_test, y_train, y_test = train_test_split(X_scaled, y)
            """,
        )
    )
    assert result.verdict == Verdict.fail
    assert "StandardScaler" in result.rationale
    assert "line 2" in result.rationale
    assert [n.root for n in result.cited_nodes] == ["a"]


def test_feature_selection_before_cross_validation_fails() -> None:
    result = check(
        step(
            "a",
            """
            selector = SelectKBest(k=10)
            X_best = selector.fit_transform(X, y)
            scores = cross_val_score(LogisticRegression(), X_best, y, cv=5)
            """,
        )
    )
    assert result.verdict == Verdict.fail
    assert "cross-validation (X_best)" in result.rationale


def test_preprocessing_inside_a_pipeline_under_cross_validation_passes() -> None:
    result = check(
        step(
            "a",
            """
            pipe = make_pipeline(StandardScaler(), LogisticRegression())
            scores = cross_val_score(pipe, X, y, cv=5)
            """,
        )
    )
    assert result.verdict == Verdict.pass_


def test_fitting_anything_on_the_holdout_fails() -> None:
    result = check(
        step(
            "a",
            """
            X_train, X_test, y_train, y_test = train_test_split(X, y)
            X_test_part = X_test[cols]
            model.fit(X_test_part, y_test)
            """,
        )
    )
    assert result.verdict == Verdict.fail
    assert "X_test_part" in result.rationale


def test_transforming_the_holdout_with_a_train_fit_passes() -> None:
    result = check(
        step(
            "a",
            """
            X_train, X_test, y_train, y_test = train_test_split(X, y)
            imputer = SimpleImputer().fit(X_train)
            X_test_filled = imputer.transform(X_test)
            """,
        )
    )
    assert result.verdict == Verdict.pass_


def test_split_in_one_step_and_holdout_fit_in_the_next_fails() -> None:
    result = check(
        step(
            "a",
            "train, test = train_test_split(df)",
            outputs=["train", "test"],
        ),
        step("b", "model.fit(test[cols], test.y)", inputs=["test"]),
        edges=[("a.test", "b.test")],
    )
    assert result.verdict == Verdict.fail
    assert [n.root for n in result.cited_nodes] == ["b"]


def test_scaling_in_one_step_before_a_split_in_a_later_step_fails() -> None:
    result = check(
        step("a", "scaled = MinMaxScaler().fit_transform(df)", outputs=["scaled"]),
        step("b", "train, test = train_test_split(scaled)", inputs=["scaled"]),
        edges=[("a.scaled", "b.scaled")],
    )
    assert result.verdict == Verdict.fail
    assert [n.root for n in result.cited_nodes] == ["a", "b"]


def test_scaling_on_a_branch_that_never_reaches_the_split_passes() -> None:
    result = check(
        step("a", "scaled = MinMaxScaler().fit_transform(df)\nplot(scaled)"),
        step("b", "train, test = train_test_split(df)"),
    )
    assert result.verdict == Verdict.pass_


def test_holdout_from_a_built_in_split_is_tracked_into_code() -> None:
    result = check(
        {"id": "split", "operator": "sprisk.validation.random_split@1.0.0", "params": {}},
        step("b", "StandardScaler().fit(held)", inputs=["held"]),
        edges=[("split.test", "b.held")],
    )
    assert result.verdict == Verdict.fail
    assert [n.root for n in result.cited_nodes] == ["b"]


def test_fits_without_any_split_are_not_assessed() -> None:
    result = check(step("a", "scaled = StandardScaler().fit_transform(df)"))
    assert result.verdict == Verdict.not_assessed
    assert "no split" in result.rationale


def test_code_that_does_not_parse_is_not_assessed_and_names_the_step() -> None:
    result = check(step("a", "def broken(:"), step("b", "train, test = train_test_split(df)"))
    assert result.verdict == Verdict.not_assessed
    assert [n.root for n in result.cited_nodes] == ["a"]


def test_code_step_without_source_is_an_input_error() -> None:
    with pytest.raises(CheckInputError, match="b"):
        check({"id": "b", "operator": CODE, "params": {"inputs": []}})


def test_holdout_rows_stay_holdout_through_a_built_in_step() -> None:
    result = check(
        {"id": "split", "operator": "sprisk.validation.random_split@1.0.0", "params": {}},
        {"id": "pick", "operator": "sprisk.clean.select_columns@1.0.0", "params": {}},
        step("b", "model.fit(t)", inputs=["t"]),
        edges=[("split.test", "pick.data"), ("pick.data", "b.t")],
    )
    assert result.verdict == Verdict.fail
    assert [n.root for n in result.cited_nodes] == ["b"]


def test_built_in_fitting_transform_keeps_train_and_test_apart() -> None:
    result = check(
        {"id": "split", "operator": "sprisk.validation.random_split@1.0.0", "params": {}},
        {"id": "scale", "operator": "sprisk.clean.scale@1.0.0", "params": {}},
        step("b", "model.fit(t)", inputs=["t"]),
        edges=[
            ("split.train", "scale.train"),
            ("split.test", "scale.test"),
            ("scale.train", "b.t"),
        ],
    )
    assert result.verdict == Verdict.pass_


def test_preprocessing_train_rows_before_cross_validation_fails() -> None:
    result = check(
        step(
            "a",
            """
            X_tr, X_te, y_tr, y_te = train_test_split(X, y)
            Xs = StandardScaler().fit_transform(X_tr)
            scores = cross_val_score(model, Xs, y_tr)
            """,
        )
    )
    assert result.verdict == Verdict.fail
    assert "line 4" in result.rationale
    assert "Xs" in result.rationale


@pytest.mark.parametrize(
    "trigger",
    [
        "cross_validate(m, Xs, y)",
        "cross_val_predict(m, Xs, y)",
        "GridSearchCV(m, grid).fit(Xs, y)",
        "folds = list(KFold(5).split(Xs))",
    ],
)
def test_every_cross_validation_form_counts_as_a_split(trigger: str) -> None:
    result = check(step("a", f"Xs = RobustScaler().fit_transform(X)\n{trigger}"))
    assert result.verdict == Verdict.fail


@pytest.mark.parametrize(
    "source",
    [
        "Z: object = X_te\nmodel.fit(Z)",
        "for Z in [X_te]:\n    model.fit(Z)",
        "if (Z := X_te) is not None:\n    model.fit(Z)",
        "Z = X_tr\nZ += X_te\nmodel.fit(Z)",
        "model.fit(pd.concat([X_tr, X_te]))",
    ],
)
def test_holdout_rows_are_followed_through_every_assignment_form(source: str) -> None:
    result = check(step("a", f"X_tr, X_te = train_test_split(X)\n{source}"))
    assert result.verdict == Verdict.fail


def test_reassigning_a_holdout_name_clears_it() -> None:
    result = check(step("a", "X_tr, X_te = train_test_split(X)\nX_te = load()\nmodel.fit(X_te)"))
    assert result.verdict == Verdict.pass_


def test_fits_inside_a_function_are_not_read() -> None:
    source = "X_tr, X_te = train_test_split(X)\ndef later():\n    model.fit(X_te)"
    assert check(step("a", source)).verdict == Verdict.pass_


def test_a_leak_outranks_a_step_that_does_not_parse() -> None:
    result = check(
        step("a", "def broken(:"), step("b", "X_tr, X_te = train_test_split(X)\nm.fit(X_te)")
    )
    assert result.verdict == Verdict.fail
    assert [n.root for n in result.cited_nodes] == ["b"]


def test_tuple_assignment_tags_each_name_from_its_own_value() -> None:
    source = (
        "X_tr, X_te = train_test_split(X)\n"
        "fit_rows, held = X_tr.copy(), X_te.copy()\n"
        "m.fit(fit_rows)"
    )
    assert check(step("a", source)).verdict == Verdict.pass_
