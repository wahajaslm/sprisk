import json
from collections.abc import Callable
from pathlib import Path
from typing import Any

import numpy as np
import polars as pl
import pytest
import skops.io
import yaml
from scipy import sparse
from sklearn.base import clone
from sklearn.linear_model import LogisticRegression

from sprisk_contracts import Operator
from sprisk_workers.errors import ManifestError, OperatorError
from sprisk_workers.matrix import Matrix
from sprisk_workers.output import JSON, MATRIX, PARQUET, SKOPS
from sprisk_workers.plain import CheckedFunction, FoldStep, adapt


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


def test_a_column_a_setting_marks_excluded_never_reaches_the_step(tmp_path: Path) -> None:
    # A check on the test rows names the target only to drop it (ADR-0064): the worker drops it.
    op_ = operator(
        "[{ name: data, kind: table }]",
        "[{ name: data, kind: table }]",
        "{ target: { type: string, x-sprisk-excluded: true } }",
    )
    seen: list[list[str]] = []

    def op(data: pl.DataFrame, target: str) -> pl.DataFrame:
        seen.append(data.columns)
        return data

    table = pl.DataFrame({"x": [1, 2], "y": ["a", "b"]})
    adapt(op, op_)({"target": "y"}, {"data": parquet(tmp_path, table)}, staging(tmp_path))

    assert seen == [["x"]]


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


def test_several_outputs_may_be_a_tuple_in_the_manifest_port_order(tmp_path: Path) -> None:
    def op(data: pl.DataFrame) -> tuple[pl.DataFrame, pl.DataFrame]:
        return data.head(1), data.tail(1)

    outputs = adapt(op, SPLIT)(
        {}, {"data": parquet(tmp_path, pl.DataFrame({"x": [1, 2]}))}, staging(tmp_path)
    )

    assert {o.port: pl.read_parquet(o.path)["x"].to_list() for o in outputs} == {
        "train": [1],
        "test": [2],
    }


def test_a_tuple_of_the_wrong_length_is_a_bad_output(tmp_path: Path) -> None:
    def op(data: pl.DataFrame) -> tuple[pl.DataFrame, ...]:
        return (data, data, data)

    with pytest.raises(OperatorError) as e:
        adapt(op, SPLIT)(
            {}, {"data": parquet(tmp_path, pl.DataFrame({"x": [1]}))}, staging(tmp_path)
        )
    assert e.value.code == "bad_output"
    assert "3 values" in str(e.value)


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


def _datetime_call() -> Any:
    import datetime as dt

    return {"call": dt.datetime}


def _numpy_function() -> Any:
    # A file naming a numpy function can have skops call it and set the result's raw state.
    import numpy as np
    from sklearn.preprocessing import FunctionTransformer

    return FunctionTransformer(np.asarray, kw_args={"dtype": "object"})


@pytest.mark.parametrize("payload", [_datetime_call, _numpy_function])
def test_a_model_file_with_untrusted_types_is_refused(
    tmp_path: Path, payload: Callable[[], Any]
) -> None:
    score = operator("[{ name: model, kind: model }]", "[{ name: metrics, kind: metrics }]")
    evil = tmp_path / "evil.skops"
    skops.io.dump(payload(), evil)

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


def test_what_a_step_prints_and_warns_becomes_its_console(tmp_path: Path) -> None:
    import warnings

    def op(data: pl.DataFrame, factor: float) -> pl.DataFrame:
        print("scaling", data.height, "rows")
        warnings.warn("factor is large", UserWarning, stacklevel=1)
        return data

    outputs = {
        o.port: o
        for o in adapt(op, ONE_TABLE)(
            {"factor": 9}, {"data": parquet(tmp_path, pl.DataFrame({"x": [1]}))}, staging(tmp_path)
        )
    }
    items = json.loads(outputs["console"].path.read_text())["items"]
    assert [(i["channel"], i["text"]) for i in items][0] == ("stdout", "scaling 1 rows\n")
    assert items[1]["channel"] == "stderr" and "factor is large" in items[1]["text"]


def test_a_quiet_step_has_no_console(tmp_path: Path) -> None:
    def op(data: pl.DataFrame, factor: float) -> pl.DataFrame:
        return data

    outputs = adapt(op, ONE_TABLE)(
        {"factor": 1}, {"data": parquet(tmp_path, pl.DataFrame({"x": [1]}))}, staging(tmp_path)
    )
    assert [o.port for o in outputs] == ["data"]


NAMED = operator(
    "[]",
    "[{ name: display, kind: diagnostics }]",
    "{ inputs: { type: array, x-sprisk-ports: input },"
    " outputs: { type: array, x-sprisk-ports: output } }",
)
NOTHING_SHOWN: dict[str, list[Any]] = {"items": []}


def test_tables_named_in_params_arrive_as_a_dict_and_leave_by_name(tmp_path: Path) -> None:
    def op(inputs: dict[str, Any], outputs: list[str]) -> dict[str, Any]:
        return {"display": NOTHING_SHOWN, "filtered": inputs["df"].filter(pl.col("x") > 1)}

    params = {"inputs": ["df"], "outputs": ["filtered"]}
    written = adapt(op, NAMED)(
        params, {"df": parquet(tmp_path, pl.DataFrame({"x": [1, 2]}))}, staging(tmp_path)
    )

    by_port = {o.port: o for o in written}
    assert set(by_port) == {"display", "filtered"}
    assert pl.read_parquet(by_port["filtered"].path)["x"].to_list() == [2]


def test_a_pandas_table_comes_back_as_pandas_to_a_code_step_and_as_polars_to_others(
    tmp_path: Path,
) -> None:
    import pandas as pd

    def make(inputs: dict[str, Any], outputs: list[str]) -> dict[str, Any]:
        return {"display": NOTHING_SHOWN, "df": pd.DataFrame({"x": [1, 2]})}

    written = adapt(make, NAMED)({"inputs": [], "outputs": ["df"]}, {}, staging(tmp_path))
    table = next(o.path for o in written if o.port == "df")
    seen: list[str] = []

    def use(inputs: dict[str, Any], outputs: list[str]) -> dict[str, Any]:
        seen.append(type(inputs["df"]).__module__.split(".")[0])
        return {"display": NOTHING_SHOWN}

    def builtin(data: pl.DataFrame, factor: float = 1.0) -> pl.DataFrame:
        seen.append(type(data).__module__.split(".")[0])
        return data

    later = tmp_path / "later"
    later.mkdir()
    adapt(use, NAMED)({"inputs": ["df"], "outputs": []}, {"df": table}, later)
    adapt(builtin, ONE_TABLE)({}, {"data": table}, later)
    assert seen == ["pandas", "polars"]


def test_a_named_output_that_is_not_a_table_names_its_type(tmp_path: Path) -> None:
    def op(inputs: dict[str, Any], outputs: list[str]) -> dict[str, Any]:
        return {"display": NOTHING_SHOWN, "lookup": {"a": 1}}

    with pytest.raises(OperatorError, match="output lookup: expected a DataFrame, got dict"):
        adapt(op, NAMED)({"inputs": [], "outputs": ["lookup"]}, {}, staging(tmp_path))


def test_an_operator_error_from_the_step_keeps_its_code_and_message(tmp_path: Path) -> None:
    def op(data: pl.DataFrame, factor: float) -> pl.DataFrame:
        raise OperatorError("code_error", "line 2: TypeError: bad")

    with pytest.raises(OperatorError) as e:
        adapt(op, ONE_TABLE)(
            {"factor": 1}, {"data": parquet(tmp_path, pl.DataFrame({"x": [1]}))}, staging(tmp_path)
        )
    assert (e.value.code, e.value.message) == ("code_error", "line 2: TypeError: bad")


COMPARE = operator(
    "[{ name: train, kind: table }]",
    "[{ name: scores, kind: table }]",
    "{ candidate: { type: string, x-sprisk-model-operator: candidate_params },"
    " candidate_params: { type: object } }",
)
MODEL_PARAMS = {
    "type": "object",
    "required": ["target"],
    "properties": {"target": {"type": "string"}, "depth": {"type": "integer"}},
}


def test_a_setting_naming_a_model_arrives_as_its_estimator_function(tmp_path: Path) -> None:
    def build(schema: pl.Schema, depth: int) -> LogisticRegression:
        return LogisticRegression(max_iter=depth)

    seen: list[Any] = []

    def op(
        train: pl.DataFrame, candidate: Callable[..., Any], candidate_params: dict[str, Any]
    ) -> pl.DataFrame:
        seen.append(candidate(schema=train.schema, depth=candidate_params["depth"]))
        return train

    models = {"acme.m.model@1.0.0": CheckedFunction(build, MODEL_PARAMS)}
    params = {"candidate": "acme.m.model@1.0.0", "candidate_params": {"target": "y", "depth": 7}}
    adapt(op, COMPARE, models=models)(
        params, {"train": parquet(tmp_path, pl.DataFrame({"x": [1]}))}, staging(tmp_path)
    )
    assert seen[0].max_iter == 7


@pytest.mark.parametrize(
    ("params", "code", "message"),
    [
        (
            {"candidate": "acme.m.other@1.0.0", "candidate_params": {"target": "y"}},
            "unknown_model",
            "acme.m.other@1.0.0 is not a model this worker can build",
        ),
        (
            {"candidate": "acme.m.model@1.0.0", "candidate_params": {"depth": 3}},
            "invalid_params",
            "acme.m.model@1.0.0: 'target' is a required property",
        ),
    ],
)
def test_an_unknown_model_or_params_it_refuses_fail_before_the_step_runs(
    tmp_path: Path, params: dict[str, Any], code: str, message: str
) -> None:
    def op(
        train: pl.DataFrame, candidate: Callable[..., Any], candidate_params: dict[str, Any]
    ) -> pl.DataFrame:
        raise AssertionError("the step must not run")

    models = {"acme.m.model@1.0.0": CheckedFunction(lambda schema: None, MODEL_PARAMS)}
    with pytest.raises(OperatorError) as e:
        adapt(op, COMPARE, models=models)(
            params, {"train": parquet(tmp_path, pl.DataFrame({"x": [1]}))}, staging(tmp_path)
        )
    assert (e.value.code, e.value.message) == (code, message)


def test_a_model_setting_must_name_a_params_setting_that_exists() -> None:
    broken = operator(
        "[{ name: train, kind: table }]",
        "[{ name: scores, kind: table }]",
        "{ candidate: { type: string, x-sprisk-model-operator: settings } }",
    )

    def op(train: pl.DataFrame, candidate: Callable[..., Any]) -> pl.DataFrame:
        return train

    with pytest.raises(ManifestError, match="candidate names settings"):
        adapt(op, broken)


FOLDED = operator(
    "[{ name: train, kind: table }]",
    "[{ name: scores, kind: table }]",
    "{ prepare: { type: array, x-sprisk-preparation: true } }",
)
SHIFT_PARAMS = {"type": "object", "required": ["by"], "properties": {"by": {"type": "number"}}}


def shift(train: pl.DataFrame, test: pl.DataFrame, by: float) -> dict[str, pl.DataFrame]:
    """Fits the train mean and moves both tables by it, plus `by`."""
    mean = train["x"].mean()
    move = pl.col("x") - mean + by
    return {"train": train.with_columns(move), "test": test.with_columns(move)}


def test_preparation_steps_arrive_as_transformers_refit_on_the_rows_they_are_fit_on(
    tmp_path: Path,
) -> None:
    seen: list[Any] = []

    def op(train: pl.DataFrame, prepare: list[Any]) -> pl.DataFrame:
        [step] = prepare
        fitted = clone(step).fit(train.head(2))
        seen.append(fitted.transform(pl.DataFrame({"x": [10.0]}))["x"].to_list())
        return train

    preparations = {"acme.c.shift@1.0.0": CheckedFunction(shift, SHIFT_PARAMS)}
    params = {"prepare": [{"operator": "acme.c.shift@1.0.0", "params": {"by": 1.0}}]}
    adapt(op, FOLDED, preparations=preparations)(
        params,
        {"train": parquet(tmp_path, pl.DataFrame({"x": [1.0, 3.0, 100.0]}))},
        staging(tmp_path),
    )
    # Fit on the first two rows: mean 2, so 10 becomes 10 - 2 + 1.
    assert seen == [[9.0]]


@pytest.mark.parametrize(
    ("step", "code", "message"),
    [
        (
            {"operator": "acme.c.other@1.0.0", "params": {}},
            "unknown_preparation",
            "acme.c.other@1.0.0 is not a step this worker can refit per fold",
        ),
        (
            {"operator": "acme.c.shift@1.0.0", "params": {}},
            "invalid_params",
            "acme.c.shift@1.0.0: 'by' is a required property",
        ),
    ],
)
def test_an_unknown_preparation_or_params_it_refuses_fail_before_the_step_runs(
    tmp_path: Path, step: dict[str, Any], code: str, message: str
) -> None:
    def op(train: pl.DataFrame, prepare: list[Any]) -> pl.DataFrame:
        raise AssertionError("the step must not run")

    preparations = {"acme.c.shift@1.0.0": CheckedFunction(shift, SHIFT_PARAMS)}
    with pytest.raises(OperatorError) as e:
        adapt(op, FOLDED, preparations=preparations)(
            {"prepare": [step]},
            {"train": parquet(tmp_path, pl.DataFrame({"x": [1.0]}))},
            staging(tmp_path),
        )
    assert (e.value.code, e.value.message) == (code, message)


def test_a_matrix_round_trips_with_its_column_names(tmp_path: Path) -> None:
    words = operator("[{ name: data, kind: table }]", "[{ name: words, kind: matrix }]")
    read = operator("[{ name: words, kind: matrix }]", "[{ name: metrics, kind: metrics }]")

    def make(data: pl.DataFrame) -> Any:
        return sparse.csr_matrix([[0.0, 1.5], [2.0, 0.0]]), ["red", "blue"]

    def use(words: Any) -> dict[str, Any]:
        values, names = words
        return {"columns": list(names), "dense": values.toarray().tolist()}

    [out] = adapt(make, words)(
        {}, {"data": parquet(tmp_path, pl.DataFrame({"x": [1, 2]}))}, staging(tmp_path)
    )
    assert out.media_type == MATRIX
    [metrics] = adapt(use, read)({}, {"words": out.path}, tmp_path / "staging")

    assert json.loads(metrics.path.read_text()) == {
        "columns": ["red", "blue"],
        "dense": [[0.0, 1.5], [2.0, 0.0]],
    }


def test_a_matrix_needs_one_name_per_column() -> None:
    with pytest.raises(ValueError, match="2 columns but 1 name"):
        Matrix(sparse.csr_array([[0.0, 1.0]]), ("red",))


def test_a_matrix_port_refuses_anything_else(tmp_path: Path) -> None:
    words = operator("[{ name: data, kind: table }]", "[{ name: words, kind: matrix }]")

    def make(data: pl.DataFrame) -> Any:
        return sparse.csr_array([[1.0]])

    with pytest.raises(OperatorError, match="output words: expected \\(a SciPy sparse matrix"):
        adapt(make, words)(
            {}, {"data": parquet(tmp_path, pl.DataFrame({"x": [1]}))}, staging(tmp_path)
        )


def test_a_matrix_refuses_repeated_names_dense_values_and_gaps() -> None:
    with pytest.raises(ValueError, match="names repeat: red"):
        Matrix(sparse.csr_array([[0.0, 1.0]]), ("red", "red"))
    with pytest.raises(ValueError, match="sparse"):
        Matrix(np.array([[0.0, 1.0]]), ("red", "blue"))
    with pytest.raises(ValueError, match="finite"):
        Matrix(sparse.csr_array([[np.nan, 1.0]]), ("red", "blue"))


def test_a_scipy_matrix_of_any_sparse_format_is_kept_as_csr() -> None:
    m = Matrix(sparse.coo_matrix([[0.0, 1.0]]), ("red", "blue"))
    assert isinstance(m.values, sparse.csr_array)


def _bad_npz(tmp_path: Path, **arrays: Any) -> Path:
    path = tmp_path / "words.npz"
    np.savez(path, **arrays)
    return path


@pytest.mark.parametrize(
    "arrays",
    [
        # No names.
        {"data": [1.0], "indices": [0], "indptr": [0, 1], "shape": [1, 1]},
        # Two columns, one name.
        {"data": [1.0], "indices": [0], "indptr": [0, 1], "shape": [1, 2], "columns": ["a"]},
        # A value outside the shape.
        {"data": [1.0], "indices": [5], "indptr": [0, 1], "shape": [1, 2], "columns": ["a", "b"]},
    ],
)
def test_a_bad_matrix_file_fails_the_step_as_invalid_input(
    tmp_path: Path, arrays: dict[str, Any]
) -> None:
    read = operator("[{ name: words, kind: matrix }]", "[{ name: metrics, kind: metrics }]")

    def use(words: Matrix) -> dict[str, Any]:
        return {}

    with pytest.raises(OperatorError) as e:
        adapt(use, read)({}, {"words": _bad_npz(tmp_path, **arrays)}, staging(tmp_path))
    assert e.value.code == "invalid_input"


def test_a_file_that_is_no_npz_fails_the_step_as_invalid_input(tmp_path: Path) -> None:
    read = operator("[{ name: words, kind: matrix }]", "[{ name: metrics, kind: metrics }]")
    path = tmp_path / "words.npz"
    path.write_bytes(b"not a matrix")

    def use(words: Matrix) -> dict[str, Any]:
        return {}

    with pytest.raises(OperatorError) as e:
        adapt(use, read)({}, {"words": path}, staging(tmp_path))
    assert e.value.code == "invalid_input"


def test_an_optional_input_left_unconnected_arrives_as_none(tmp_path: Path) -> None:
    fit = operator(
        "[{ name: train, kind: table }, { name: words, kind: matrix, optional: true }]",
        "[{ name: metrics, kind: metrics }]",
    )

    def op(train: pl.DataFrame, words: Matrix | None) -> dict[str, Any]:
        return {"rows": train.height, "words": words is not None}

    [out] = adapt(op, fit)(
        {}, {"train": parquet(tmp_path, pl.DataFrame({"x": [1, 2]}))}, staging(tmp_path)
    )
    assert json.loads(out.path.read_text()) == {"rows": 2, "words": False}


def test_a_required_input_left_unconnected_fails_the_step(tmp_path: Path) -> None:
    def op(data: pl.DataFrame, factor: float) -> pl.DataFrame:
        return data

    with pytest.raises(OperatorError, match="input data is not connected"):
        adapt(op, ONE_TABLE)({"factor": 1}, {}, staging(tmp_path))


def test_a_matrix_pair_the_matrix_refuses_is_a_bad_output(tmp_path: Path) -> None:
    words = operator("[{ name: data, kind: table }]", "[{ name: words, kind: matrix }]")

    def make(data: pl.DataFrame) -> Any:
        return sparse.csr_array([[1.0, 2.0]]), ["red"]

    with pytest.raises(OperatorError, match="output words: matrix has 2 columns but 1 name"):
        adapt(make, words)(
            {}, {"data": parquet(tmp_path, pl.DataFrame({"x": [1]}))}, staging(tmp_path)
        )


def _words_step(train: pl.DataFrame, test: pl.DataFrame, column: str) -> dict[str, Any]:
    names = ["red"]
    made = {
        port: (sparse.csr_array(rows.select(column).to_numpy().astype(float)), names)
        for port, rows in (("train_words", train), ("test_words", test))
    }
    return {"train": train.drop(column), "test": test.drop(column), **made}


def _double(train: pl.DataFrame, test: pl.DataFrame) -> dict[str, pl.DataFrame]:
    return {"train": train * 2, "test": test * 2}


def test_a_fold_step_that_makes_words_passes_them_on_beside_the_table() -> None:
    rows = pl.DataFrame({"n": [1, 2], "x": [3, 4]})
    words_step, double = FoldStep(_words_step, {"column": "n"}), FoldStep(_double, {})

    table, words = double.fit(words_step.fit_transform(rows)).transform(words_step.transform(rows))

    assert table.to_dict(as_series=False) == {"x": [6, 8]}
    assert words[0].toarray().tolist() == [[1.0], [2.0]]
    assert list(words[1]) == ["red"]


def test_a_second_fold_step_that_makes_words_is_refused() -> None:
    rows = pl.DataFrame({"n": [1, 2], "x": [3, 4]})
    first = FoldStep(_words_step, {"column": "n"}).fit_transform(rows)
    with pytest.raises(ValueError, match="only one step may make words"):
        FoldStep(_words_step, {"column": "x"}).fit(first).transform(first)
