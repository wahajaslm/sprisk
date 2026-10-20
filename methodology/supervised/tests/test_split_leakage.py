import json
from pathlib import Path

import pytest
import yaml

from sprisk_contracts import MethodologyCheck, Operator, PipelineVersion
from sprisk_contracts.generated.models import Verdict
from sprisk_supervised.split_leakage import CheckInputError, split_leakage

PLUGINS = Path(__file__).parents[3] / "plugins"
CHECK_ID = "mck_01JABCDEFGHJKMNPQRSTVWXYZ0"
NOW = "2026-10-16T10:00:00Z"

SOURCE = "sprisk.io.file_source@1.0.0"
SPLIT = "sprisk.validation.random_split@1.0.0"
DUMMY = "sprisk.ml.dummy_baseline@1.0.0"
LINEAR = "sprisk.ml.linear_model@1.0.0"
EVAL = "sprisk.ml.evaluate@1.0.0"


# Test-only operators for pipeline shapes the core packs cannot build yet.
SCALE = "sprisk.test.scale@1.0.0"
ENSEMBLE = "sprisk.test.ensemble@1.0.0"
TWO_TABLE_EVAL = "sprisk.test.two_table_eval@1.0.0"


def fake(
    op_id: str, cls: str, inputs: list[tuple[str, str]], outputs: list[tuple[str, str]]
) -> Operator:
    return Operator.model_validate_json(
        json.dumps(
            {
                "schema_version": "sprisk.operator/v1",
                "id": op_id,
                "capability_class": cls,
                "entrypoint": "fake.mod:fn",
                "inputs": [{"name": n, "kind": k} for n, k in inputs],
                "outputs": [{"name": n, "kind": k} for n, k in outputs],
                "params_schema": {},
                "effects": "pure",
                "network": "none",
                "resources": {"cpu_cores": 1, "memory_mb": 1, "gpu": "none", "timeout_seconds": 1},
            }
        )
    )


def operators() -> dict[str, Operator]:
    ops = {
        SCALE: fake(SCALE, "transform", [("data", "table")], [("data", "table")]),
        ENSEMBLE: fake(
            ENSEMBLE, "estimator", [("a", "model"), ("b", "model")], [("model", "model")]
        ),
        TWO_TABLE_EVAL: fake(
            TWO_TABLE_EVAL,
            "evaluator",
            [("model", "model"), ("test", "table"), ("other", "table")],
            [("metrics", "metrics")],
        ),
    }
    for path in PLUGINS.rglob("manifest.yaml"):
        op = Operator.model_validate_json(json.dumps(yaml.safe_load(path.read_text())))
        ops[op.id.root] = op
    return ops


def pipeline(nodes: dict[str, str], edges: list[tuple[str, str]]) -> PipelineVersion:
    return PipelineVersion.model_validate_json(
        json.dumps(
            {
                "schema_version": "sprisk.pipeline_version/v1",
                "id": "plv_01JABCDEFGHJKMNPQRSTVWXYZ0",
                "project_id": "prj_01JABCDEFGHJKMNPQRSTVWXYZ0",
                "nodes": [{"id": n, "operator": op, "params": {}} for n, op in nodes.items()],
                "edges": [{"from": a, "to": b} for a, b in edges],
                "created_at": NOW,
            }
        )
    )


def compare(models: dict[str, str]) -> PipelineVersion:
    """Source → split → each model fit on train → one evaluate per model on split.test."""
    nodes = {"load": SOURCE, "split": SPLIT}
    edges = [("load.data", "split.data")]
    for name, op in models.items():
        nodes[name] = op
        nodes[f"eval_{name}"] = EVAL
        edges += [
            ("split.train", f"{name}.train"),
            (f"{name}.model", f"eval_{name}.model"),
            ("split.test", f"eval_{name}.test"),
        ]
    return pipeline(nodes, edges)


def check(p: PipelineVersion) -> MethodologyCheck:
    result = split_leakage(p, operators(), CHECK_ID, NOW)
    return MethodologyCheck.model_validate_json(result.model_dump_json(by_alias=True))


def test_baseline_plus_one_model_passes() -> None:
    result = check(compare({"dummy": DUMMY, "linear": LINEAR}))
    assert result.verdict == Verdict.pass_
    assert [n.root for n in result.cited_nodes] == ["eval_dummy", "eval_linear", "split"]
    assert result.limitations is not None
    assert result.check.root == "supervised.split_leakage@1.0.0"


def test_two_models_on_one_test_table_fail_and_cite_them() -> None:
    result = check(compare({"dummy": DUMMY, "lin_a": LINEAR, "lin_b": LINEAR}))
    assert result.verdict == Verdict.fail
    assert [n.root for n in result.cited_nodes] == ["eval_lin_a", "eval_lin_b", "split"]
    assert "split.test" in result.rationale


def test_two_models_on_separate_test_tables_pass() -> None:
    p = pipeline(
        {
            "load": SOURCE,
            "s1": SPLIT,
            "s2": SPLIT,
            "a": LINEAR,
            "b": LINEAR,
            "ea": EVAL,
            "eb": EVAL,
        },
        [
            ("load.data", "s1.data"),
            ("load.data", "s2.data"),
            ("s1.train", "a.train"),
            ("s2.train", "b.train"),
            ("a.model", "ea.model"),
            ("b.model", "eb.model"),
            ("s1.test", "ea.test"),
            ("s2.test", "eb.test"),
        ],
    )
    assert check(p).verdict == Verdict.pass_


def test_same_model_scored_twice_on_one_table_passes() -> None:
    p = compare({"linear": LINEAR})
    p2 = pipeline(
        {**{n.id.root: n.operator.root for n in p.nodes}, "eval_again": EVAL},
        [(e.from_.root, e.to.root) for e in p.edges]
        + [("linear.model", "eval_again.model"), ("split.test", "eval_again.test")],
    )
    assert check(p2).verdict == Verdict.pass_


def test_no_evaluator_is_not_assessed() -> None:
    result = check(pipeline({"load": SOURCE}, []))
    assert result.verdict == Verdict.not_assessed
    assert result.cited_nodes == []


def nodes_edges(p: PipelineVersion) -> tuple[dict[str, str], list[tuple[str, str]]]:
    return {n.id.root: n.operator.root for n in p.nodes}, [
        (e.from_.root, e.to.root) for e in p.edges
    ]


def test_per_model_transforms_do_not_hide_the_test_table() -> None:
    nodes = {"load": SOURCE, "split": SPLIT, "a": LINEAR, "b": LINEAR, "ea": EVAL, "eb": EVAL}
    nodes |= {"scale_a": SCALE, "scale_b": SCALE}
    edges = [
        ("load.data", "split.data"),
        ("split.train", "a.train"),
        ("split.train", "b.train"),
        ("split.test", "scale_a.data"),
        ("split.test", "scale_b.data"),
        ("a.model", "ea.model"),
        ("b.model", "eb.model"),
        ("scale_a.data", "ea.test"),
        ("scale_b.data", "eb.test"),
    ]
    result = check(pipeline(nodes, edges))
    assert result.verdict == Verdict.fail
    assert "split.test" in result.rationale


def test_model_fit_on_the_test_table_fails() -> None:
    nodes = {"load": SOURCE, "split": SPLIT, "cheat": LINEAR}
    edges = [("load.data", "split.data"), ("split.test", "cheat.train")]
    result = check(pipeline(nodes, edges))
    assert result.verdict == Verdict.fail
    assert [n.root for n in result.cited_nodes] == ["cheat", "split"]


def test_estimator_wrapping_two_models_counts_as_one_candidate() -> None:
    nodes = {"load": SOURCE, "split": SPLIT, "a": LINEAR, "b": LINEAR, "ens": ENSEMBLE, "e": EVAL}
    edges = [
        ("load.data", "split.data"),
        ("split.train", "a.train"),
        ("split.train", "b.train"),
        ("a.model", "ens.a"),
        ("b.model", "ens.b"),
        ("ens.model", "e.model"),
        ("split.test", "e.test"),
    ]
    assert check(pipeline(nodes, edges)).verdict == Verdict.pass_


def test_scoring_models_on_the_train_table_is_not_a_holdout_issue() -> None:
    nodes, edges = nodes_edges(compare({"lin_a": LINEAR, "lin_b": LINEAR}))
    edges = [(a, b) if a != "split.test" else ("split.train", b) for a, b in edges]
    assert check(pipeline(nodes, edges)).verdict == Verdict.pass_


def test_evaluator_with_two_table_inputs_is_an_input_error() -> None:
    nodes, edges = nodes_edges(compare({"linear": LINEAR}))
    nodes["eval_linear"] = TWO_TABLE_EVAL
    edges.append(("split.train", "eval_linear.other"))
    with pytest.raises(CheckInputError, match="eval_linear"):
        split_leakage(pipeline(nodes, edges), operators(), CHECK_ID, NOW)


def test_unknown_operator_is_an_input_error() -> None:
    with pytest.raises(CheckInputError, match="sprisk.test.missing@1.0.0"):
        split_leakage(pipeline({"x": "sprisk.test.missing@1.0.0"}, []), operators(), CHECK_ID, NOW)


def test_unconnected_evaluator_input_is_an_input_error() -> None:
    with pytest.raises(CheckInputError, match="e.test"):
        split_leakage(pipeline({"e": EVAL}, []), operators(), CHECK_ID, NOW)


IMPUTE = "sprisk.clean.impute@1.0.0"


def cleaned(train_from: str, test_from: str) -> PipelineVersion:
    """load → split → impute(train, test) → linear + evaluate on the imputed tables."""
    return pipeline(
        {"load": SOURCE, "split": SPLIT, "impute": IMPUTE, "linear": LINEAR, "eval": EVAL},
        [
            ("load.data", "split.data"),
            (train_from, "impute.train"),
            (test_from, "impute.test"),
            ("impute.train", "linear.train"),
            ("linear.model", "eval.model"),
            ("impute.test", "eval.test"),
        ],
    )


def test_fit_on_train_transform_after_the_split_passes() -> None:
    # impute's train output carries no test rows, so the model is not fit on the holdout.
    assert check(cleaned("split.train", "split.test")).verdict == Verdict.pass_


def test_fit_on_train_transform_fed_unsplit_data_fails() -> None:
    result = check(cleaned("load.data", "load.data"))
    assert result.verdict == Verdict.fail
    assert "impute" in [n.root for n in result.cited_nodes]


def test_fit_on_train_transform_fitting_on_the_test_rows_fails() -> None:
    result = check(cleaned("split.test", "split.test"))
    assert result.verdict == Verdict.fail
    assert "impute" in [n.root for n in result.cited_nodes]


CONCAT = "sprisk.test.concat@1.0.0"


def test_fitting_transform_fed_train_rows_mixed_with_raw_data_fails() -> None:
    # Merging the full table back in brings the holdout rows into the fit.
    ops = operators()
    ops[CONCAT] = fake(CONCAT, "transform", [("a", "table"), ("b", "table")], [("data", "table")])
    p = pipeline(
        {"load": SOURCE, "split": SPLIT, "mix": CONCAT, "impute": IMPUTE},
        [
            ("load.data", "split.data"),
            ("split.train", "mix.a"),
            ("load.data", "mix.b"),
            ("mix.data", "impute.train"),
            ("split.test", "impute.test"),
        ],
    )
    result = split_leakage(p, ops, CHECK_ID, NOW)
    assert result.verdict == Verdict.fail
    assert "impute" in [n.root for n in result.cited_nodes]


def test_fitting_transform_test_input_must_be_the_same_splits_holdout() -> None:
    for test_from in ["split.train", "load.data"]:
        result = check(cleaned("split.train", test_from))
        assert result.verdict == Verdict.fail, test_from


def test_chained_fitting_transforms_after_the_split_pass() -> None:
    p = pipeline(
        {
            "load": SOURCE,
            "split": SPLIT,
            "impute": IMPUTE,
            "scale": "sprisk.clean.scale@1.0.0",
            "linear": LINEAR,
            "eval": EVAL,
        },
        [
            ("load.data", "split.data"),
            ("split.train", "impute.train"),
            ("split.test", "impute.test"),
            ("impute.train", "scale.train"),
            ("impute.test", "scale.test"),
            ("scale.train", "linear.train"),
            ("linear.model", "eval.model"),
            ("scale.test", "eval.test"),
        ],
    )
    assert check(p).verdict == Verdict.pass_


def test_model_trained_on_a_transforms_test_output_fails() -> None:
    p = cleaned("split.train", "split.test")
    nodes, edges = nodes_edges(p)
    edges = [(a, b) if b != "linear.train" else ("impute.test", b) for a, b in edges]
    assert check(pipeline(nodes, edges)).verdict == Verdict.fail


def test_unconnected_fitting_transform_train_is_an_input_error() -> None:
    p = pipeline({"impute": IMPUTE}, [])
    with pytest.raises(CheckInputError, match="impute.train"):
        split_leakage(p, operators(), CHECK_ID, NOW)


CROSS_VALIDATE = "sprisk.ml.cross_validate@1.0.0"
SELECT = "sprisk.ml.select_model@1.0.0"


def cross_validated(rows_from: str) -> PipelineVersion:
    """A comparison (ADR-0044): two cross-validate steps fed `rows_from`, one select step."""
    nodes = {"load": SOURCE, "split": SPLIT, "cv_a": CROSS_VALIDATE, "cv_b": CROSS_VALIDATE}
    nodes["select_model"] = SELECT
    edges = [
        ("load.data", "split.data"),
        (rows_from, "cv_a.train"),
        (rows_from, "cv_b.train"),
        ("cv_a.scores", "select_model.a"),
        ("cv_b.scores", "select_model.b"),
    ]
    return pipeline(nodes, edges)


def test_a_comparison_on_the_train_rows_is_not_a_holdout_issue() -> None:
    assert check(cross_validated("split.train")).verdict == Verdict.not_assessed


def test_a_comparison_fed_the_test_rows_fails() -> None:
    result = check(cross_validated("split.test"))
    assert result.verdict == Verdict.fail
    assert result.rationale.startswith("cv_a learns from the test set (split.test)")
