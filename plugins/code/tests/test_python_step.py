import json
from collections.abc import Mapping
from pathlib import Path
from typing import Any

import polars as pl
import pytest
from conftest import WriteParquet

from sprisk_code.python_step import (
    MAX_TABLE_ROWS,
    python_step,
    python_step_v12,
    python_step_with_output,
)
from sprisk_contracts import CodeDisplay, CodeInterface
from sprisk_workers.errors import OperatorError


def run(write_parquet: WriteParquet, df: pl.DataFrame, out_dir: Path, source: str) -> CodeDisplay:
    return CodeDisplay.model_validate_json(json.dumps(python_step(df, source)))


def test_last_expression_is_shown_as_a_table(
    write_parquet: WriteParquet, clf_frame: pl.DataFrame, out_dir: Path
) -> None:
    shown = run(write_parquet, clf_frame, out_dir, "data.group_by('c').len().sort('c')")
    [item] = shown.items
    assert item.kind == "table" and item.table is not None
    assert [c.name for c in item.table.columns] == ["c", "len"]
    assert [r.values for r in item.table.rows] == [["a", "30"], ["b", "30"]]


def test_printed_text_comes_before_the_last_value(
    write_parquet: WriteParquet, clf_frame: pl.DataFrame, out_dir: Path
) -> None:
    shown = run(write_parquet, clf_frame, out_dir, "print(data.height)\nn = 2\nn * 21")
    assert [(i.kind, i.text) for i in shown.items] == [("text", "60\n"), ("text", "42")]


def test_matplotlib_figures_are_captured_as_svg(
    write_parquet: WriteParquet, clf_frame: pl.DataFrame, out_dir: Path
) -> None:
    source = "import matplotlib.pyplot as plt\nplt.plot([1, 2])\nplt.title('line')\nplt.show()"
    [item] = run(write_parquet, clf_frame, out_dir, source).items
    assert item.kind == "figure" and item.figure is not None
    assert (item.figure.library.value, item.figure.format.value) == ("matplotlib", "svg")
    assert "<svg" in item.figure.content and item.figure.title == "line"


def test_a_plotly_figure_is_shown_live_from_show_or_as_the_last_value(
    write_parquet: WriteParquet, clf_frame: pl.DataFrame, out_dir: Path
) -> None:
    source = (
        "import plotly.express as px\n"
        "fig = px.histogram(x=[1, 2, 2], title='counts')\n"
        "fig.show()\n"
        "fig"
    )
    items = run(write_parquet, clf_frame, out_dir, source).items
    assert [(i.kind, i.figure.format.value if i.figure else None) for i in items] == [
        ("figure", "plotly_json"),
        ("figure", "plotly_json"),
    ]
    assert items[0].figure is not None and items[0].figure.title == "counts"


def test_an_altair_chart_is_kept_as_vega_lite(
    write_parquet: WriteParquet, clf_frame: pl.DataFrame, out_dir: Path
) -> None:
    # Recognised by its module, as the worker does; altair itself is not a dependency.
    source = (
        "class Chart:\n"
        "    def to_json(self):\n"
        '        return \'{"mark": "bar"}\'\n'
        "Chart.__module__ = 'altair.vegalite.v5.api'\n"
        "Chart()"
    )
    [item] = run(write_parquet, clf_frame, out_dir, source).items
    assert item.figure is not None
    assert (item.figure.library.value, item.figure.format.value) == ("altair", "vega_lite_json")
    assert item.figure.content == '{"mark": "bar"}'


def test_big_result_shows_only_the_first_rows(write_parquet: WriteParquet, out_dir: Path) -> None:
    df = pl.DataFrame({"i": range(1000), "x": [None, *range(1, 1000)]})
    [item] = run(write_parquet, df, out_dir, "data").items
    assert item.table is not None
    assert (len(item.table.rows), item.table.total_rows) == (MAX_TABLE_ROWS, 1000)
    assert [m.root for m in item.table.rows[0].missing] == [1]


def test_error_in_user_code_fails_with_the_line(
    write_parquet: WriteParquet, clf_frame: pl.DataFrame, out_dir: Path
) -> None:
    with pytest.raises(OperatorError) as e:
        run(write_parquet, clf_frame, out_dir, "x = 1\ny = x / 0")
    assert e.value.code == "code_error"
    assert "line 2" in e.value.message and "ZeroDivisionError" in e.value.message


def test_syntax_error_names_the_line(
    write_parquet: WriteParquet, clf_frame: pl.DataFrame, out_dir: Path
) -> None:
    with pytest.raises(OperatorError) as e:
        run(write_parquet, clf_frame, out_dir, "ok = 1\nnot python(")
    assert e.value.code == "code_error" and "line 2" in e.value.message


def test_floats_are_shown_short(write_parquet: WriteParquet, out_dir: Path) -> None:
    df = pl.DataFrame({"r": [6.907999999999995, 1e-12, 123456789.0]})
    [item] = run(write_parquet, df, out_dir, "data").items
    assert item.table is not None
    assert [r.values for r in item.table.rows] == [["6.908"], ["1e-12"], ["1.23457e+08"]]


def test_huge_figure_is_replaced_by_a_note(
    write_parquet: WriteParquet, clf_frame: pl.DataFrame, out_dir: Path
) -> None:
    source = (
        "import matplotlib.pyplot as plt, numpy as np\n"
        "plt.figure(figsize=(40, 40))\n"
        "plt.imshow(np.random.default_rng(0).random((800, 800)))\nNone"
    )
    [note] = run(write_parquet, clf_frame, out_dir, source).items
    assert note.kind == "text" and note.text is not None and "not shown" in note.text


def test_output_becomes_the_data_port(write_parquet: WriteParquet, out_dir: Path) -> None:
    df = pl.DataFrame({"x": [1.0, 2.0, 3.0]})
    source = "sprisk.output(data.with_columns(y=pl.col('x') * 2))"
    outputs = python_step_with_output(df, source)
    assert outputs["data"]["y"].to_list() == [2.0, 4.0, 6.0]
    assert set(outputs) == {"data", "display"}


def test_without_output_the_input_passes_through_unchanged(
    write_parquet: WriteParquet, out_dir: Path
) -> None:
    df = pl.DataFrame({"x": [1, 2]})
    assert python_step_with_output(df, "data.height")["data"] is df


def test_output_must_be_a_polars_dataframe(
    write_parquet: WriteParquet, clf_frame: pl.DataFrame, out_dir: Path
) -> None:
    with pytest.raises(OperatorError) as e:
        python_step_with_output(clf_frame, "sprisk.output([1, 2])")
    assert e.value.code == "code_error" and "polars DataFrame" in e.value.message


def run_v12(
    write_parquet: WriteParquet, out_dir: Path, params: Mapping[str, Any]
) -> dict[str, Any]:
    out = python_step_v12(pl.DataFrame({"x": [1.0, 2.0, 3.0]}), **params)
    return {**out, "interface": CodeInterface.model_validate_json(json.dumps(out["interface"]))}


SOURCE = (
    "factor = 2\nout = data.with_columns(y=pl.col('x') * factor)\nif False:\n    print(lookup)\n"
)


def test_exposed_parameter_changes_the_run_but_not_the_source(
    write_parquet: WriteParquet, out_dir: Path
) -> None:
    params = {"source": SOURCE, "parameters": {"factor": 10}, "output": "out"}
    paths = run_v12(write_parquet, out_dir, params)
    assert paths["data"]["y"].to_list() == [10.0, 20.0, 30.0]
    assert params["source"] == SOURCE
    found = paths["interface"]
    [factor] = found.parameters
    assert (factor.name, factor.default_text, factor.effective_text, factor.origin.value) == (
        "factor",
        "2",
        "10",
        "confirmed",
    )


def test_interface_reports_inputs_and_output_candidates(
    write_parquet: WriteParquet, out_dir: Path
) -> None:
    paths = run_v12(write_parquet, out_dir, {"source": SOURCE})
    found = paths["interface"]
    assert [(i.name, i.bound) for i in found.inputs] == [("data", True), ("lookup", False)]
    [out] = found.outputs
    assert (out.name, out.type, out.rows, out.columns, out.chosen) == (
        "out",
        "polars.DataFrame",
        3,
        2,
        False,
    )
    assert found.parameters[0].origin.value == "inferred"


def test_chosen_output_must_be_a_dataframe(write_parquet: WriteParquet, out_dir: Path) -> None:
    with pytest.raises(OperatorError) as e:
        run_v12(write_parquet, out_dir, {"source": SOURCE, "output": "factor"})
    assert e.value.code == "code_error" and "factor" in e.value.message and "int" in e.value.message


def test_output_keeps_the_order_it_happened_in(
    write_parquet: WriteParquet, clf_frame: pl.DataFrame, out_dir: Path
) -> None:
    source = (
        "import matplotlib.pyplot as plt\n"
        "print('first')\n"
        "display(data.head(2))\n"
        "print('second')\n"
        "plt.plot([1, 2])\n"
        "plt.show()\n"
        "fig, ax = plt.subplots()\n"
        "display(fig, 'note')\n"
        "plt.figure()\n"
        "data.height\n"
    )
    items = run(write_parquet, clf_frame, out_dir, source).items
    kinds = [(i.kind, i.text) for i in items]
    assert kinds == [
        ("text", "first\n"),
        ("table", None),
        ("text", "second\n"),
        ("figure", None),
        ("figure", None),
        ("text", "'note'"),
        ("text", "60"),
        ("figure", None),
    ]


def test_a_figure_as_the_last_value_is_shown_once(
    write_parquet: WriteParquet, clf_frame: pl.DataFrame, out_dir: Path
) -> None:
    source = "import matplotlib.pyplot as plt\nfig, ax = plt.subplots()\nfig"
    items = run(write_parquet, clf_frame, out_dir, source).items
    assert [i.kind for i in items] == ["figure"]


def test_stderr_and_warnings_are_kept_apart_from_printed_text(
    write_parquet: WriteParquet, clf_frame: pl.DataFrame, out_dir: Path
) -> None:
    source = (
        "import sys, warnings\nprint('ok')\n"
        "warnings.warn('small sample')\nprint('done', file=sys.stderr)\n"
    )
    items = run(write_parquet, clf_frame, out_dir, source).items
    assert [(i.channel.value if i.channel else None) for i in items] == ["stdout", "stderr"]
    assert items[0].text == "ok\n"
    assert items[1].text is not None and "small sample" in items[1].text and "done" in items[1].text


def test_interface_lists_files_the_code_reads(write_parquet: WriteParquet, out_dir: Path) -> None:
    source = 'path = "lookup.csv"\nif False:\n    pl.read_csv(path)\ndata\n'
    found = run_v12(write_parquet, out_dir, {"source": source})["interface"]
    assert [(f.path, f.reader) for f in found.files] == [("lookup.csv", "read_csv")]
    assert found.parameters == []


def test_a_step_s_own_code_is_loaded_as_a_function() -> None:
    from sprisk_code.python_step import load_function

    fn = load_function(
        "import polars as pl\n\ndef double(data, factor=2):\n    return data * factor\n", "double"
    )
    assert fn(3) == 6


def test_own_code_without_the_function_or_with_an_error_says_so() -> None:
    from sprisk_code.python_step import load_function

    with pytest.raises(OperatorError, match="defines no function named run"):
        load_function("x = 1\n", "run")
    with pytest.raises(OperatorError, match="line 1: SyntaxError"):
        load_function("def run(:\n", "run")


def test_every_variable_can_be_explored(write_parquet: WriteParquet, out_dir: Path) -> None:
    source = (
        "filtered = pl.DataFrame({'age': [34, None, 51], 'city': ['Oslo', 'Rome', None]})\n"
        "ages = filtered['age']\n"
        "lookup = {'a': 1}\n"
    )
    found = run_v12(write_parquet, out_dir, {"source": source})["interface"]
    by_name = {o.name: o for o in found.outputs}

    table = by_name["filtered"]
    assert [(f.name, f.data_type, f.null_count) for f in table.fields or []] == [
        ("age", "Int64", 1),
        ("city", "String", 1),
    ]
    assert table.sample is not None and table.sample.total_rows == 3
    assert [r.values for r in table.sample.rows] == [["34", "Oslo"], ["", "Rome"], ["51", ""]]

    series = by_name["ages"]
    assert (series.rows, series.columns) == (3, 1)
    assert series.sample is not None and series.sample.columns[0].name == "age"

    assert by_name["lookup"].text == "{'a': 1}"
    assert by_name["lookup"].sample is None


def test_variable_samples_stay_within_a_size_budget(
    write_parquet: WriteParquet, out_dir: Path
) -> None:
    wide = "pl.DataFrame({f'c{i}': ['x' * 400] * 30 for i in range(60)})"
    source = "".join(f"t{n} = {wide}\n" for n in range(19)) + "note = 'y' * 50_000\n"
    out = python_step_v12(pl.DataFrame({"x": [1.0]}), source)
    found = CodeInterface.model_validate_json(json.dumps(out["interface"]))
    assert len(json.dumps(out["interface"])) < 1024 * 1024  # the browser's limit for it
    first, last = found.outputs[0], found.outputs[18]
    assert first.sample is not None and len(first.sample.rows) <= 10
    assert last.sample is None and last.fields is not None and len(last.fields) == 60
    note = found.outputs[19]
    assert note.text is not None and len(note.text) < 2000


def test_a_nested_value_s_text_is_capped(write_parquet: WriteParquet, out_dir: Path) -> None:
    source = "nested = [[['x' * 5000] * 30] * 30] * 30\n"
    found = run_v12(write_parquet, out_dir, {"source": source})["interface"]
    [nested] = found.outputs
    assert nested.text is not None and len(nested.text) <= 2001


def test_a_wide_table_lists_its_first_fields(write_parquet: WriteParquet, out_dir: Path) -> None:
    source = "wide = pl.DataFrame({f'c{i}': [1] for i in range(501)})\n"
    found = run_v12(write_parquet, out_dir, {"source": source})["interface"]
    [wide] = found.outputs
    assert wide.columns == 501 and wide.fields is not None and len(wide.fields) == 500


def test_notebook_cells_get_tables_by_name_and_pass_variables_on() -> None:
    from sprisk_code.python_step import python_step_v2

    source = "min_age = 18\nfiltered = df.filter(pl.col('age') >= min_age)\nprint(filtered.height)"
    df = pl.DataFrame({"age": [10, 20, 30]})
    out = python_step_v2(
        {"df": df}, "import polars as pl\n" + source, {"min_age": 25}, ["filtered"]
    )
    assert out["filtered"]["age"].to_list() == [30]
    assert set(out) == {"display", "interface", "filtered"}
    found = CodeInterface.model_validate_json(json.dumps(out["interface"]))
    assert [(i.name, i.bound) for i in found.inputs] == [("df", True)]
    assert [o.name for o in found.outputs if o.chosen] == ["filtered"]


def test_pandas_cells_work_and_their_tables_show(write_parquet: WriteParquet) -> None:
    import pandas as pd

    from sprisk_code.python_step import python_step_v2

    source = "import pandas as pd\nsmall = raw[raw['x'] > 1]\nsmall.head()"
    out = python_step_v2({"raw": pd.DataFrame({"x": [1, 2, 3]})}, source, None, ["small"])
    assert isinstance(out["small"], pd.DataFrame) and out["small"]["x"].tolist() == [2, 3]
    shown = CodeDisplay.model_validate_json(json.dumps(out["display"]))
    assert [i.kind for i in shown.items] == ["table"]
    found = CodeInterface.model_validate_json(json.dumps(out["interface"]))
    small = next(o for o in found.outputs if o.name == "small")
    assert (small.type, small.rows) == ("pandas.DataFrame", 2)


def test_a_variable_a_later_step_reads_must_be_set() -> None:
    from sprisk_code.python_step import python_step_v2

    with pytest.raises(OperatorError, match="does not set summary"):
        python_step_v2({}, "x = 1", None, ["summary"])


def test_only_tables_pass_between_steps_and_the_message_says_what_to_do() -> None:
    from sprisk_code.python_step import python_step_v2

    with pytest.raises(OperatorError) as e:
        python_step_v2({}, "lookup = {'a': 1}", None, ["lookup"])
    assert e.value.code == "code_error"
    assert "lookup is a dict, not a table" in e.value.message
    assert "one step" in e.value.message


def test_each_plot_names_the_code_line_that_showed_it(
    write_parquet: WriteParquet, clf_frame: pl.DataFrame, out_dir: Path
) -> None:
    source = (
        "import matplotlib.pyplot as plt\n"
        "plt.plot([1, 2])\n"
        "plt.show()\n"
        "def draw():\n"
        "    display(plt.figure())\n"
        "draw()\n"
        "import plotly.express as px\n"
        "px.histogram(x=[1, 2])"
    )
    items = run(write_parquet, clf_frame, out_dir, source).items
    assert [(i.kind, i.line) for i in items] == [
        ("figure", 3),
        ("figure", 5),
        ("figure", 8),
    ]
