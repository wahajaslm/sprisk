import base64
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


def test_matplotlib_figures_are_captured_as_png(
    write_parquet: WriteParquet, clf_frame: pl.DataFrame, out_dir: Path
) -> None:
    source = "import matplotlib.pyplot as plt\nplt.hist(data['x'].drop_nulls())\nNone"
    [image] = run(write_parquet, clf_frame, out_dir, source).items
    assert image.kind == "image" and image.png_base64 is not None
    assert base64.b64decode(image.png_base64).startswith(b"\x89PNG")


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
        ("image", None),
        ("image", None),
        ("text", "'note'"),
        ("text", "60"),
        ("image", None),
    ]


def test_a_figure_as_the_last_value_is_shown_once(
    write_parquet: WriteParquet, clf_frame: pl.DataFrame, out_dir: Path
) -> None:
    source = "import matplotlib.pyplot as plt\nfig, ax = plt.subplots()\nfig"
    items = run(write_parquet, clf_frame, out_dir, source).items
    assert [i.kind for i in items] == ["image"]


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
