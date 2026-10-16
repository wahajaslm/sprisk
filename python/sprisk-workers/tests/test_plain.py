import json
from pathlib import Path
from typing import Any

import polars as pl
import pytest
import skops.io
import yaml
from sklearn.linear_model import LogisticRegression

from sprisk_contracts import Operator
from sprisk_workers.errors import ManifestError, OperatorError
from sprisk_workers.output import JSON, PARQUET, SKOPS
from sprisk_workers.plain import adapt


def operator(inputs: str, outputs: str, params: str = "{}") -> Operator:
    text = f"""
schema_version: sprisk.operator/v1
id: acme.t.op@1.0.0
capability_class: transform
entrypoint: sprisk_x.op:op
inputs: {inputs}
outputs: {outputs}
params_schema: {{ type: object, properties: {params} }}
effects: pure
network: none
resources: {{ cpu_cores: 1, memory_mb: 512, gpu: none, timeout_seconds: 60 }}
"""
    return Operator.model_validate_json(json.dumps(yaml.safe_load(text)))


ONE_TABLE = operator(
    "[{ name: data, kind: table }]",
    "[{ name: data, kind: table }]",
    "{ factor: { type: number } }",
)
SPLIT = operator(
    "[{ name: data, kind: table }]",
    "[{ name: train, kind: table }, { name: test, kind: table }]",
)


def parquet(tmp_path: Path, df: pl.DataFrame) -> Path:
    path = tmp_path / "in.parquet"
    df.write_parquet(path)
    return path


def staging(tmp_path: Path) -> Path:
    path = tmp_path / "staging"
    path.mkdir()
    return path


def test_tables_and_params_arrive_by_name_and_the_return_value_is_the_output(
    tmp_path: Path,
) -> None:
    def op(data: pl.DataFrame, factor: float) -> pl.DataFrame:
        return data.with_columns(pl.col("x") * factor)

    run = adapt(op, ONE_TABLE)
    outputs = run(
        {"factor": 3}, {"data": parquet(tmp_path, pl.DataFrame({"x": [1, 2]}))}, staging(tmp_path)
    )

    [out] = outputs
    assert (out.port, out.media_type) == ("data", PARQUET)
    assert pl.read_parquet(out.path)["x"].to_list() == [3, 6]


def test_several_outputs_are_returned_as_a_dict_by_port(tmp_path: Path) -> None:
    def op(data: pl.DataFrame) -> dict[str, pl.DataFrame]:
        return {"train": data.head(1), "test": data.tail(1)}

    outputs = adapt(op, SPLIT)(
        {}, {"data": parquet(tmp_path, pl.DataFrame({"x": [1, 2]}))}, staging(tmp_path)
    )

    assert {o.port: pl.read_parquet(o.path)["x"].to_list() for o in outputs} == {
        "train": [1],
        "test": [2],
    }


def test_a_model_is_saved_safely_and_metrics_as_json(tmp_path: Path) -> None:
    fit = operator(
        "[{ name: train, kind: table }]",
        "[{ name: model, kind: model }, { name: metrics, kind: metrics }]",
    )

    def op(train: pl.DataFrame) -> dict[str, Any]:
        model = LogisticRegression().fit(train.select("x").to_numpy(), train["y"].to_numpy())
        return {"model": model, "metrics": {"n_rows": train.height}}

    train = pl.DataFrame({"x": [0.0, 1.0, 0.1, 0.9], "y": [0, 1, 0, 1]})
    outputs = {
        o.port: o
        for o in adapt(op, fit)({}, {"train": parquet(tmp_path, train)}, staging(tmp_path))
    }

    assert outputs["model"].media_type == SKOPS
    assert isinstance(skops.io.load(outputs["model"].path), LogisticRegression)
    assert outputs["metrics"].media_type == JSON
    assert json.loads(outputs["metrics"].path.read_text()) == {"n_rows": 4}


def test_a_model_input_arrives_as_the_fitted_estimator(tmp_path: Path) -> None:
    score = operator("[{ name: model, kind: model }]", "[{ name: metrics, kind: metrics }]")
    model = LogisticRegression().fit([[0.0], [1.0]], [0, 1])
    path = tmp_path / "model.skops"
    skops.io.dump(model, path)

    def op(model: LogisticRegression) -> dict[str, Any]:
        return {"classes": [int(c) for c in model.classes_]}

    [out] = adapt(op, score)({}, {"model": path}, staging(tmp_path))
    assert json.loads(out.path.read_text()) == {"classes": [0, 1]}


def test_value_error_is_an_invalid_input_failure_with_its_message(tmp_path: Path) -> None:
    def op(data: pl.DataFrame, factor: float) -> pl.DataFrame:
        raise ValueError("factor must be positive")

    with pytest.raises(OperatorError) as e:
        adapt(op, ONE_TABLE)(
            {"factor": -1}, {"data": parquet(tmp_path, pl.DataFrame({"x": [1]}))}, staging(tmp_path)
        )
    assert (e.value.code, e.value.message) == ("invalid_input", "factor must be positive")


def test_a_missing_column_is_reported_as_such(tmp_path: Path) -> None:
    def op(data: pl.DataFrame, factor: float) -> pl.DataFrame:
        return data.select("nope")

    with pytest.raises(OperatorError) as e:
        adapt(op, ONE_TABLE)(
            {"factor": 1}, {"data": parquet(tmp_path, pl.DataFrame({"x": [1]}))}, staging(tmp_path)
        )
    assert e.value.code == "missing_column"
    assert "nope" in e.value.message


def test_a_wrong_return_type_names_the_port_and_what_came_back(tmp_path: Path) -> None:
    def op(data: pl.DataFrame, factor: float) -> Any:
        return [1, 2]

    with pytest.raises(OperatorError) as e:
        adapt(op, ONE_TABLE)(
            {"factor": 1}, {"data": parquet(tmp_path, pl.DataFrame({"x": [1]}))}, staging(tmp_path)
        )
    assert e.value.code == "bad_output"
    assert "data" in e.value.message and "list" in e.value.message


def test_a_missing_or_extra_output_is_an_error(tmp_path: Path) -> None:
    def op(data: pl.DataFrame) -> dict[str, pl.DataFrame]:
        return {"train": data, "extra": data}

    with pytest.raises(OperatorError) as e:
        adapt(op, SPLIT)(
            {}, {"data": parquet(tmp_path, pl.DataFrame({"x": [1]}))}, staging(tmp_path)
        )
    assert e.value.code == "bad_output"


def test_a_function_whose_arguments_do_not_match_the_manifest_fails_at_load() -> None:
    def op(data: pl.DataFrame, factr: float) -> pl.DataFrame:
        return data

    with pytest.raises(ManifestError, match="factr"):
        adapt(op, ONE_TABLE)


def test_an_input_port_the_function_does_not_take_fails_at_load() -> None:
    def op(factor: float) -> pl.DataFrame:
        return pl.DataFrame()

    with pytest.raises(ManifestError, match="data"):
        adapt(op, ONE_TABLE)


def test_an_optional_setting_left_out_uses_the_functions_default(tmp_path: Path) -> None:
    def op(data: pl.DataFrame, factor: float = 10) -> pl.DataFrame:
        return data.with_columns(pl.col("x") * factor)

    [out] = adapt(op, ONE_TABLE)(
        {}, {"data": parquet(tmp_path, pl.DataFrame({"x": [1]}))}, staging(tmp_path)
    )
    assert pl.read_parquet(out.path)["x"].to_list() == [10]
