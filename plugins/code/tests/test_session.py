import json
import subprocess
import sys
import threading
import time
from collections.abc import Iterator
from pathlib import Path

import pytest

from sprisk_code.session import Limits, Outputs, Session
from sprisk_contracts import NotebookExecution, NotebookVariables

LIMITS = Limits(cell_seconds=20, memory_mb=2048)


def iopub(msg_type: str, **content: object) -> dict[str, object]:
    return {"msg_type": msg_type, "content": content}


def items(outputs: Outputs) -> list[dict[str, object]]:
    return outputs.items


def test_printed_chunks_on_one_stream_join_into_one_item() -> None:
    out = Outputs()
    out.add(iopub("stream", name="stdout", text="Loading...\n"))
    out.add(iopub("stream", name="stdout", text="Loaded 3 rows\n"))
    out.add(iopub("stream", name="stderr", text="careful\n"))
    assert items(out) == [
        {"kind": "text", "text": "Loading...\nLoaded 3 rows\n", "channel": "stdout"},
        {"kind": "text", "text": "careful\n", "channel": "stderr"},
    ]


def test_sprisk_display_wins_over_plain_text_and_html() -> None:
    table = {"kind": "table", "table": {"offset": 0}}
    out = Outputs()
    out.add(
        iopub(
            "execute_result",
            data={
                "application/vnd.sprisk.display+json": table,
                "text/html": "<table><script>alert(1)</script></table>",
                "text/plain": "   a\n0  1",
            },
        )
    )
    assert items(out) == [table]


def test_html_alone_is_never_shown_only_its_plain_text() -> None:
    out = Outputs()
    out.add(iopub("display_data", data={"text/html": "<b>x</b>", "text/plain": "x"}))
    assert items(out) == [{"kind": "text", "text": "x"}]


def test_a_png_is_an_image_and_plotly_json_is_a_figure() -> None:
    out = Outputs()
    out.add(iopub("display_data", data={"image/png": "iVBOR", "text/plain": "<Figure>"}))
    figure = {"data": [], "layout": {"title": {"text": "Sales"}}}
    out.add(iopub("display_data", data={"application/vnd.plotly.v1+json": figure}))
    assert items(out)[0] == {"kind": "image", "png_base64": "iVBOR"}
    assert items(out)[1]["kind"] == "figure"
    assert items(out)[1]["figure"] == {
        "library": "plotly",
        "format": "plotly_json",
        "content": json.dumps(figure),
    }


def test_an_error_keeps_its_traceback_without_colour_codes() -> None:
    out = Outputs()
    out.add(
        iopub(
            "error",
            ename="NameError",
            evalue="name 'df' is not defined",
            traceback=["\x1b[31mNameError\x1b[0m: name 'df' is not defined"],
        )
    )
    assert out.error == {
        "name": "NameError",
        "message": "name 'df' is not defined",
        "traceback": ["NameError: name 'df' is not defined"],
    }


def test_clear_output_removes_what_was_shown() -> None:
    out = Outputs()
    out.add(iopub("stream", name="stdout", text="10%"))
    out.add(iopub("clear_output", wait=False))
    out.add(iopub("stream", name="stdout", text="100%"))
    assert items(out) == [{"kind": "text", "text": "100%", "channel": "stdout"}]


def test_outputs_are_capped() -> None:
    out = Outputs()
    out.add(iopub("stream", name="stdout", text="x" * 30_000))
    for i in range(200):
        out.add(iopub("display_data", data={"text/plain": str(i)}))
    assert len(items(out)) == 100
    assert str(items(out)[0]["text"]).endswith("…")


def test_figures_past_the_cap_are_noted_not_shown() -> None:
    out = Outputs()
    for _ in range(15):
        out.add(iopub("display_data", data={"image/png": "iVBOR"}))
    kinds = [str(i["kind"]) for i in items(out)]
    assert kinds == ["image"] * 12 + ["text"]
    assert items(out)[-1]["text"] == "More than 12 figures; the rest are not shown."


@pytest.fixture(scope="module")
def session(tmp_path_factory: pytest.TempPathFactory) -> Iterator[Session]:
    started = Session(LIMITS, tmp_path_factory.mktemp("kernel"))
    yield started
    started.shutdown()


def test_cells_share_one_kernel_and_count_their_runs(session: Session) -> None:
    first = session.execute("x = 41")
    second = session.execute("x + 1")
    assert (first.status, second.status) == ("ok", "ok")
    assert second.execution_count is not None and first.execution_count is not None
    assert second.execution_count == first.execution_count + 1
    assert [o.model_dump(exclude_none=True) for o in second.outputs] == [
        {"kind": "text", "text": "42"}
    ]


def test_a_table_shows_its_first_rows_after_what_was_printed(session: Session) -> None:
    done = session.execute("import pandas as pd\nprint('loading')\npd.DataFrame({'a': [1, 2, 3]})")
    kinds = [o.kind for o in done.outputs]
    assert kinds == ["text", "table"]
    table = done.outputs[1].table
    assert table is not None and table.total_rows == 3


def test_a_matplotlib_plot_is_an_svg_figure(session: Session) -> None:
    done = session.execute("import matplotlib.pyplot as plt\nplt.plot([1, 2, 3])\nplt.title('t')")
    figures = [o.figure for o in done.outputs if o.kind == "figure"]
    assert len(figures) == 1 and figures[0] is not None
    assert figures[0].format == "svg"


def test_an_error_is_reported_and_the_kernel_keeps_its_state(session: Session) -> None:
    session.execute("kept = 7")
    failed = session.execute("undefined_name + 1")
    assert failed.status == "error"
    assert failed.error is not None and failed.error.name == "NameError"
    assert session.execute("kept").outputs[0].text == "7"


def test_variables_say_which_names_are_tables(session: Session) -> None:
    session.execute("import polars as pl\nframe = pl.DataFrame({'a': [1]})\nn = 3")
    found = session.variables(["frame", "n", "missing"])
    assert [(v.name.root, v.defined, v.type, v.table) for v in found.variables] == [
        ("frame", True, "polars.DataFrame", True),
        ("n", True, "builtins.int", False),
        ("missing", False, None, False),
    ]


def test_interrupt_stops_a_running_cell(session: Session) -> None:
    threading.Timer(1.0, session.interrupt).start()
    done = session.execute("import time\ntime.sleep(30)")
    assert done.status == "interrupted"
    assert session.execute("1 + 1").outputs[0].text == "2"


def test_a_cell_over_its_time_limit_is_stopped(tmp_path: Path) -> None:
    short = Session(Limits(cell_seconds=1, memory_mb=2048), tmp_path)
    try:
        started = time.monotonic()
        done = short.execute("import time\ntime.sleep(30)")
        assert done.status == "timed_out"
        assert time.monotonic() - started < 15
        assert short.execute("1 + 1").outputs[0].text == "2"
    finally:
        short.shutdown()


def test_a_kernel_over_its_memory_cap_is_restarted_and_says_so(tmp_path: Path) -> None:
    small = Session(Limits(cell_seconds=20, memory_mb=400), tmp_path)
    try:
        small.execute("kept = 1")
        done = small.execute("import time\nbig = b'x' * 600_000_000\ntime.sleep(5)")
        assert done.status == "error"
        assert done.error is not None and done.error.name == "MemoryLimit"
        assert "400 MB" in done.error.message
        assert small.execute("'kept' in dir()").outputs[0].text == "False"
    finally:
        small.shutdown()


def test_the_host_answers_kernel_requests_one_json_line_each(tmp_path: Path) -> None:
    lines = [
        {"op": "execute", "code": "import pandas as pd\neligible = pd.DataFrame({'a': [1]})"},
        {"op": "variables", "names": ["eligible"]},
        {"op": "shutdown"},
    ]
    done = subprocess.run(
        [
            sys.executable,
            "-m",
            "sprisk_code.session",
            "--cell-seconds",
            "20",
            "--memory-mb",
            "2048",
        ],
        input="".join(json.dumps(line) + "\n" for line in lines),
        capture_output=True,
        text=True,
        cwd=tmp_path,
        timeout=60,
        check=True,
    )
    execution, variables = done.stdout.splitlines()
    assert NotebookExecution.model_validate_json(execution).status == "ok"
    [found] = NotebookVariables.model_validate_json(variables).variables
    assert found.table


def test_the_host_refuses_a_malformed_request(tmp_path: Path) -> None:
    done = subprocess.run(
        [
            sys.executable,
            "-m",
            "sprisk_code.session",
            "--cell-seconds",
            "20",
            "--memory-mb",
            "2048",
        ],
        input='{"op": "eval", "code": "x"}\n',
        capture_output=True,
        text=True,
        cwd=tmp_path,
        timeout=60,
    )
    assert done.returncode != 0
    assert "NotebookKernelRequest" in done.stderr
