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


def test_a_model_file_with_untrusted_types_is_refused(tmp_path: Path) -> None:
    import datetime as dt

    score = operator("[{ name: model, kind: model }]", "[{ name: metrics, kind: metrics }]")
    evil = tmp_path / "evil.skops"
    skops.io.dump({"call": dt.datetime}, evil)

    def op(model: Any) -> dict[str, Any]:
        return {}

    with pytest.raises(OperatorError) as e:
        adapt(op, score)({}, {"model": evil}, staging(tmp_path))
    assert e.value.code == "untrusted_model"


def test_a_table_on_a_diagnostics_port_is_saved_as_parquet(tmp_path: Path) -> None:
    profile = operator("[{ name: data, kind: table }]", "[{ name: profile, kind: diagnostics }]")

    def op(data: pl.DataFrame) -> pl.DataFrame:
        return data.describe()

    [out] = adapt(op, profile)(
        {}, {"data": parquet(tmp_path, pl.DataFrame({"x": [1]}))}, staging(tmp_path)
    )
    assert out.media_type == PARQUET


FIGURE_OP = operator("[{ name: data, kind: table }]", "[{ name: figures, kind: figure }]")


def figures(tmp_path: Path, fn: Any) -> list[dict[str, Any]]:
    [out] = adapt(fn, FIGURE_OP)(
        {}, {"data": parquet(tmp_path, pl.DataFrame({"x": [1, 2]}))}, staging(tmp_path)
    )
    assert out.media_type == JSON
    items: list[dict[str, Any]] = json.loads(out.path.read_text())["items"]
    return items


def test_a_matplotlib_figure_is_saved_as_svg(tmp_path: Path) -> None:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    def op(data: pl.DataFrame) -> Any:
        fig, ax = plt.subplots()
        ax.plot(data["x"].to_list())
        ax.set_title("x over rows")
        return fig

    [item] = figures(tmp_path, op)
    assert (item["library"], item["format"], item["title"]) == ("matplotlib", "svg", "x over rows")
    assert item["content"].lstrip().startswith("<?xml") or "<svg" in item["content"][:500]


def test_plotly_figures_are_saved_as_their_json_and_lists_keep_order(tmp_path: Path) -> None:
    import plotly.graph_objects as go

    def op(data: pl.DataFrame) -> Any:
        return [go.Figure(go.Bar(x=["a"], y=[1]), layout={"title": {"text": "first"}}), go.Figure()]

    first, second = figures(tmp_path, op)
    assert (first["library"], first["format"], first["title"]) == ("plotly", "plotly_json", "first")
    assert json.loads(first["content"])["data"][0]["type"] == "bar"
    assert "title" not in second


def test_a_figure_of_an_unknown_library_names_its_type(tmp_path: Path) -> None:
    def op(data: pl.DataFrame) -> Any:
        return object()

    with pytest.raises(OperatorError) as e:
        figures(tmp_path, op)
    assert e.value.code == "bad_output" and "object" in e.value.message


SOURCE = operator(
    "[]",
    "[{ name: data, kind: table }]",
    "{ path: { type: string, x-sprisk-local-path: true }, sep: { type: string } }",
)


def test_a_path_argument_arrives_as_a_path(tmp_path: Path) -> None:
    from pathlib import Path as P

    seen: list[object] = []

    def op(path: P, sep: str = ",") -> pl.DataFrame:
        seen.append(path)
        return pl.DataFrame({"x": [1]})

    adapt(op, SOURCE)({"path": "/data/a.csv"}, {}, staging(tmp_path))
    assert seen == [P("/data/a.csv")]


def test_a_path_argument_must_be_a_marked_local_path() -> None:
    from pathlib import Path as P

    def op(path: P, sep: P) -> pl.DataFrame:
        return pl.DataFrame()

    with pytest.raises(ManifestError, match="sep.*x-sprisk-local-path"):
        adapt(op, SOURCE)


def test_a_marked_local_path_must_be_typed_as_a_path() -> None:
    def op(path: str, sep: str = ",") -> pl.DataFrame:
        return pl.DataFrame()

    with pytest.raises(ManifestError, match="path.*pathlib.Path"):
        adapt(op, SOURCE)
