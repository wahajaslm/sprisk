import base64
from pathlib import Path

import polars as pl
import pytest
from conftest import WriteParquet

from sprisk_code.python_step import MAX_TABLE_ROWS, python_step
from sprisk_contracts import CodeDisplay
from sprisk_workers.errors import OperatorError


def run(write_parquet: WriteParquet, df: pl.DataFrame, out_dir: Path, source: str) -> CodeDisplay:
    [out] = python_step({"source": source}, {"data": write_parquet("d", df)}, out_dir)
    assert (out.port, out.media_type) == ("display", "application/json")
    return CodeDisplay.model_validate_json(out.path.read_text())


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
