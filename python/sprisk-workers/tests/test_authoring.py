"""A decorated operator compiles to a contract-valid manifest, its notebook cell is its own
code, and the build finds stale output (ADR-0071)."""

import importlib.util
import sys
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import authored_clean
import authored_method
import authored_never_first
import authored_ops
import authored_two_methods
import authored_two_reasons
import authored_views
import polars as pl
import pytest
from authored_ops import every_nth
from polars.testing import assert_frame_equal

from sprisk_workers.authoring import Verdict, method, operator, option, visualizations
from sprisk_workers.build_packs import (
    compile_packs,
    main,
    method_manifest,
    operator_manifest,
    promise_manifest,
    stale,
)
from sprisk_workers.errors import ManifestError
from sprisk_workers.notebook_code import read_settings, source_cell


def test_a_decorated_operator_compiles_to_its_manifest() -> None:
    manifest = operator_manifest(every_nth)

    assert manifest.id.root == "authored.ops.every_nth@1.0.0"
    assert manifest.title == "Every nth"
    assert manifest.role is not None and manifest.role.value == "split"
    assert manifest.description == "Keep every nth row in time order; the others are dropped."
    assert manifest.entrypoint.root == "authored_ops:every_nth"
    assert manifest.notebook_code is not None
    assert manifest.notebook_code.root == "authored_ops:every_nth"
    assert [(p.name.root, p.kind.value) for p in manifest.inputs] == [("data", "table")]
    assert [p.name.root for p in manifest.outputs] == ["kept", "dropped"]
    assert manifest.concepts is not None
    assert {k: v.root for k, v in manifest.concepts.items()} == {
        "order_column": "common.event_time"
    }
    assert manifest.params_schema == {
        "type": "object",
        "additionalProperties": False,
        "required": ["order_column"],
        "properties": {
            "order_column": {"type": "string", "description": "Rows are kept in this order.",
                             "minLength": 1, "x-sprisk-column": True},
            "every": {"type": "integer",
                      "description": "Keeps one row in this many, starting with the first.",
                      "minimum": 2, "maximum": 10, "x-sprisk-step": 1, "default": 2},
            "note": {"type": "string"},
        },
    }  # fmt: skip


@pytest.mark.parametrize(
    ("fn", "message"),
    [
        (authored_ops.wrong_inputs, r"declares inputs \['rows'\]; its tables are \['data'\]"),
        (authored_ops.raw_bytes, "raw_bytes.raw: bytes has no JSON type"),
        (authored_ops.untyped, "untyped.n: has no type annotation"),
        (authored_ops.no_doc, "no_doc has no docstring"),
        (authored_ops.uses_constant, r"uses \['LIMIT'\], which its notebook cell would not have"),
        (authored_ops.odd_tunable, "odd_tunable.n: unknown tunable most"),
        (authored_ops.ghost, r"ghost: \['ghost'\] are not settings"),
    ],
)
def test_the_build_refuses_an_operator_it_cannot_compile(fn: Any, message: str) -> None:
    with pytest.raises(ManifestError, match=message):
        operator_manifest(fn)


def test_a_nested_function_cannot_be_a_notebook_cell() -> None:
    @operator(id="nested", inputs=["data"], outputs=["out"])
    def nested(data: pl.DataFrame) -> pl.DataFrame:
        """Defined inside a function."""
        return data

    with pytest.raises(ManifestError, match="nested is not a single top-level function"):
        operator_manifest(nested)


ROWS = pl.DataFrame({"day": [3, 1, 2, 5, 4], "x": [30, 10, 20, 50, 40]})
SETTINGS = {"order_column": "day", "every": 2}
NAMES = ({"data": "rows"}, {"kept": "train", "dropped": "test"})


def test_the_notebook_cell_is_the_function_itself_and_runs_like_the_step() -> None:
    cell = source_cell(every_nth)(SETTINGS, *NAMES)

    assert "@operator" not in cell and "sprisk" not in cell
    assert cell.startswith("import polars as pl\n")
    assert "def every_nth(" in cell
    assert cell.rstrip().endswith("train, test = every_nth(rows, order_column='day', every=2)")
    scope: dict[str, Any] = {"rows": ROWS}
    exec(compile(cell, "<cell>", "exec"), scope)
    kept, dropped = every_nth(ROWS, "day", 2)
    assert_frame_equal(scope["train"], kept)
    assert_frame_equal(scope["test"], dropped)


def test_an_edited_value_in_the_call_line_reads_back_as_a_setting() -> None:
    write = source_cell(every_nth)
    edited = write(SETTINGS, *NAMES).replace("every=2", "every=3")

    assert read_settings(write, SETTINGS, *NAMES, edited) == {"order_column": "day", "every": 3}


def test_an_edited_function_body_is_custom_code() -> None:
    write = source_cell(every_nth)
    edited = write(SETTINGS, *NAMES).replace("% every == 0", "% every == 1")

    assert read_settings(write, SETTINGS, *NAMES, edited) is None


OPS = '''
import polars as pl

from sprisk_workers.authoring import Verdict, operator, promise


@promise(id="kept_apart", text="Kept apart.", evidence="evaluation.apart", fields={"n": int})
def kept_apart(train: pl.DataFrame, test: pl.DataFrame) -> Verdict:
    return Verdict("pass", "Apart.", {"n": 0})


@operator(
    id="first_rows", inputs=["data"], outputs=["out"], role="split", folds="plain",
    promises=[kept_apart], stage="split",
)
def first_rows(data: pl.DataFrame, n: int = 5) -> pl.DataFrame:
    """The first rows."""
    return data.head(n)
'''


@pytest.fixture
def pack(tmp_path: Path) -> Iterator[Path]:
    """A plugin package on disk, importable as acme_pack."""
    root = tmp_path / "plugins" / "acme"
    (root / "src" / "acme_pack").mkdir(parents=True)
    (root / "pyproject.toml").write_text('[project]\nname = "acme"\n')
    (root / "src" / "acme_pack" / "__init__.py").write_text("")
    (root / "src" / "acme_pack" / "first_rows.py").write_text(OPS)
    sys.path.insert(0, str(root / "src"))
    yield tmp_path / "plugins"
    sys.path.remove(str(root / "src"))
    for name in [m for m in sys.modules if m.startswith("acme_pack")]:
        del sys.modules[name]


def test_the_build_writes_each_manifest_next_to_its_pack(pack: Path) -> None:
    written = compile_packs([pack], trusted=("acme_pack",))

    path = pack / "acme" / "operators" / "first_rows" / "manifest.yaml"
    check = pack / "acme" / "operators" / "apart" / "manifest.yaml"
    assert list(written) == [path, check]
    assert written[path].startswith("# Method IR compiled from acme_pack.first_rows:first_rows.")
    assert "id: acme.pack.first_rows@1.0.0" in written[path]
    assert "id: acme.pack.apart@1.0.0" in written[check]
    # The check step is in its operator's stage.
    assert "\nstage: split\n" in written[path] and "\nstage: split\n" in written[check]


def test_stale_lists_missing_changed_and_orphaned_manifests(pack: Path) -> None:
    written = compile_packs([pack], trusted=("acme_pack",))
    path, check = written
    assert stale(written, [pack]) == [check, path]

    for each in written:
        each.parent.mkdir(parents=True)
        each.write_text(written[each])
    assert stale(written, [pack]) == []

    path.write_text(written[path].replace("The first rows.", "Changed by hand."))
    assert stale(written, [pack]) == [path]

    orphan = pack / "acme" / "operators" / "gone" / "manifest.yaml"
    orphan.parent.mkdir(parents=True)
    orphan.write_text("# Method IR compiled from acme_pack.gone:gone. Do not edit.\n")
    path.write_text(written[path])
    assert stale(written, [pack]) == [orphan]


def test_two_operators_with_one_id_are_refused(pack: Path) -> None:
    second = OPS.replace("def first_rows(", "def first_rows_again(")
    (pack / "acme" / "src" / "acme_pack" / "again.py").write_text(second)

    with pytest.raises(ManifestError, match="two operators compile to the same file"):
        compile_packs([pack], trusted=("acme_pack",))


def test_a_hand_written_manifest_is_never_overwritten(pack: Path) -> None:
    path = pack / "acme" / "operators" / "first_rows" / "manifest.yaml"
    path.parent.mkdir(parents=True)
    path.write_text("schema_version: sprisk.operator/v1\n")

    with pytest.raises(ManifestError, match="is written by hand"):
        compile_packs([pack], trusted=("acme_pack",))


def test_a_pack_that_cannot_be_imported_is_an_error(pack: Path) -> None:
    (pack / "acme" / "src" / "acme_pack" / "broken.py").write_text("import not_a_module\n")

    with pytest.raises(ManifestError, match="cannot import acme_pack"):
        compile_packs([pack], trusted=("acme_pack",))


def test_main_writes_then_checks_clean_then_removes_an_orphan(
    pack: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("sprisk_workers.build_packs.TRUSTED_PACKAGES", ("acme_pack",))
    written = pack / "acme" / "operators" / "first_rows" / "manifest.yaml"

    assert main(["--check", str(pack)]) == 1
    assert main([str(pack)]) == 0
    assert written.read_text().startswith("# Method IR compiled from acme_pack.first_rows")
    assert main(["--check", str(pack)]) == 0

    orphan = pack / "acme" / "operators" / "gone" / "manifest.yaml"
    orphan.parent.mkdir(parents=True)
    orphan.write_text("# Method IR compiled from acme_pack.gone:gone. Do not edit.\n")
    assert main(["--check", str(pack)]) == 1
    assert main([str(pack)]) == 0
    assert not orphan.exists()
    assert written.exists()


def test_main_refuses_a_misspelt_flag_or_a_missing_folder(tmp_path: Path) -> None:
    with pytest.raises(SystemExit):
        main(["--chek", str(tmp_path)])
    with pytest.raises(SystemExit):
        main(["--check", str(tmp_path / "nowhere")])
    with pytest.raises(SystemExit):
        main(["--check"])


KINDS = {"common.target": "label", "common.event_time": "time"}


def test_a_promise_compiles_to_the_evidence_step_that_checks_it() -> None:
    manifest = promise_manifest(authored_method.no_shared_rows, "split", KINDS)

    assert manifest.id.root == "authored.method.shared_rows@1.0.0"
    assert manifest.capability_class.value == "analyzer"
    assert manifest.entrypoint.root == "authored_method:no_shared_rows"
    assert manifest.attach is not None
    assert (manifest.attach.role.value, manifest.attach.side.value) == ("split", "output")
    assert [(p.name.root, p.kind.value) for p in manifest.inputs] == [
        ("train", "table"),
        ("test", "table"),
    ]
    assert [(p.name.root, p.kind.value) for p in manifest.outputs] == [("evidence", "report")]
    assert manifest.produces is not None
    fields = manifest.produces["evaluation.shared_rows"].fields
    assert {k: v.value for k, v in fields.items()} == {
        "shared": "integer",
        "examples": "string_list",
        "status": "string",
        "detail": "string",
    }
    # A label column is dropped before the check runs, so it never reads a test label.
    assert manifest.params_schema["properties"]["label"]["x-sprisk-excluded"] is True


def test_a_method_compiles_to_its_options_promises_and_needs() -> None:
    manifest = method_manifest(authored_method.split_way, "methodology.test")
    body = manifest.model_dump(mode="json", exclude_none=True)

    assert body["id"] == "methodology.test.split_way@1.0.0"
    assert (body["name"], body["question"]) == ("Split way", "How are rows divided?")
    assert body["pitfall"] == "A split that ignores time trains on the future."
    assert body["decides"] == "split.way"
    assert body["needs"] == {
        "concepts": ["common.event_time"],
        "evidence": [],
        "decisions": ["data.repeated_items"],
    }
    assert body["options"] == [
        {
            "id": "by_time",
            "label": "Train on earlier rows, test on later ones",
            "description": "Earlier rows train; later rows test.",
            "condition": "time column named",
            "when": "a time column is named",
            "rationale": "A time column orders the rows.",
            "action": {
                "replace": {
                    "role": "split",
                    "operator": "authored.method.time_split@1.0.0",
                    "settings": {"test_fraction": 0.2},
                }
            },
            "verify": ["no_shared_rows"],
        },
        {
            "id": "first_rows",
            "label": "The first rows train",
            "description": "The first rows train; the rest test.",
            "condition": "¬ time column",
            "when": "no time column is named",
            "rationale": "No time column.",
            "action": {
                "replace": {
                    "role": "split",
                    "operator": "authored.method.head_split@1.0.0",
                    "settings": {"n": 10},
                }
            },
            "verify": ["no_shared_rows"],
        },
    ]
    assert body["verifications"] == {
        "no_shared_rows": {
            "needs": "evaluation.shared_rows",
            "promise": "No row is in both kept and dropped.",
        }
    }


def test_a_verdict_is_pass_fail_or_inconclusive() -> None:
    with pytest.raises(ValueError, match="maybe is not a verdict"):
        Verdict("maybe", "Unsure.", {})


def test_an_option_must_name_a_decorated_operator() -> None:
    def plain(data: pl.DataFrame) -> pl.DataFrame:
        return data

    with pytest.raises(ManifestError, match="option odd names plain, which is not an operator"):

        @method(
            id="odd", decides="x.odd", activity="Test", applies_when={},
            options={"odd": option("Odd", plain, when="always", condition="⊤")}, source="test",
        )  # fmt: skip
        def odd(task: str) -> object:
            """Odd

            Which?
            """
            return method.choose("odd", reason="Only one.")


@pytest.mark.parametrize(
    ("fn", "message"),
    [
        (authored_never_first.never_first, "never_first never chooses first_rows"),
        (authored_two_reasons.two_reasons, "two_reasons gives by_time two reasons"),
    ],
)
def test_each_option_needs_one_reason_its_rationale(fn: Any, message: str) -> None:
    with pytest.raises(ManifestError, match=message):
        method_manifest(fn, "methodology.test")


def test_a_method_file_holds_one_method() -> None:
    with pytest.raises(
        ManifestError, match="authored_two_methods holds 2 methods; a method file holds one"
    ):
        method_manifest(authored_two_methods.first, "methodology.test")


def test_an_operator_keeps_its_label_column_and_only_a_promise_drops_it() -> None:
    kinds = {"common.target": "label"}
    split = operator_manifest(authored_method.head_split, kinds)
    assert all("x-sprisk-excluded" not in p for p in split.params_schema["properties"].values())
    check = promise_manifest(authored_method.no_shared_rows, "split", kinds)
    assert check.params_schema["properties"]["label"]["x-sprisk-excluded"] is True


def test_an_operator_s_views_are_found_in_its_file_and_become_a_figures_output() -> None:
    assert visualizations(authored_views.halves) == [
        authored_views.rows_per_side,
        authored_views.items_per_side,
    ]
    manifest = operator_manifest(authored_views.halves)
    assert [(p.name.root, p.kind.value) for p in manifest.outputs] == [
        ("train", "table"),
        ("test", "table"),
        ("figures", "figure"),
    ]


VIEWED = '''
import plotly.graph_objects as go
import polars as pl

from sprisk_workers.authoring import operator


@operator(
    id="halves", inputs=["data"], outputs=["train", "test"], columns={"label": "common.target"}
)
def halves(data: pl.DataFrame, label: str) -> tuple[pl.DataFrame, pl.DataFrame]:
    """Halves."""
    return data.head(1), data.tail(1)
'''

SECOND = '''

@operator(id="again", inputs=["data"], outputs=["out"])
def again(data: pl.DataFrame) -> pl.DataFrame:
    """Again."""
    return data
'''


@pytest.mark.parametrize(
    ("view", "message"),
    [
        (
            "def shares(train: pl.DataFrame, test: pl.DataFrame, label: str) -> go.Figure:\n"
            "    return go.Figure()\n",
            "view shares reads label, a label column; a view runs before the final score",
        ),
        (
            "def sizes(train: pl.DataFrame, rows: pl.DataFrame) -> go.Figure:\n"
            "    return go.Figure()\n",
            r"view sizes takes \['rows'\], which are not outputs or settings of halves",
        ),
        (
            SECOND + "\n\ndef sizes(train: pl.DataFrame) -> go.Figure:\n    return go.Figure()\n",
            "views_file has views and 2 operators; an operator file holds one",
        ),
    ],
)
def test_the_build_refuses_a_view_it_cannot_run(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, view: str, message: str
) -> None:
    path = tmp_path / "views_file.py"
    path.write_text(VIEWED + "\n\n" + view)
    spec = importlib.util.spec_from_file_location("views_file", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    monkeypatch.setitem(sys.modules, "views_file", module)
    spec.loader.exec_module(module)

    with pytest.raises(ManifestError, match=message):
        operator_manifest(module.halves, {"common.target": "label"})


def test_settings_ports_and_fields_compile_as_the_clean_operators_declare_them() -> None:
    manifest = operator_manifest(authored_clean.fill_gaps).model_dump(
        mode="json", exclude_none=True
    )

    assert {k: manifest[k] for k in ("title", "stage", "fits_on_train", "produces")} == {
        "title": "Gap filling",
        "stage": "clean",
        "fits_on_train": True,
        "produces": {"data.gaps": {"fields": {"rows": "integer"}}},
    }
    assert manifest["inputs"] == [
        {"name": "train", "kind": "table"},
        {"name": "test", "kind": "table"},
        {"name": "words", "kind": "matrix", "optional": True},
    ]
    assert manifest["outputs"] == [
        {"name": "train", "kind": "table"},
        {"name": "test", "kind": "table"},
        {"name": "evidence", "kind": "report", "description": "Rows filled."},
    ]
    assert manifest["params_schema"] == {
        "type": "object",
        "additionalProperties": False,
        "required": ["columns", "method"],
        "properties": {
            "columns": {"type": "array", "items": {"type": "string", "minLength": 1},
                        "minItems": 1, "uniqueItems": True,
                        "description": "Columns whose gaps are filled."},
            "method": {"type": "string", "enum": ["median", "mean"],
                       "description": "Statistic of the train rows."},
            "text_fill": {"type": "object", "additionalProperties": {"type": "string"}},
            "share": {"type": "number", "exclusiveMinimum": 0, "maximum": 1, "default": 0.5},
            "keep": {"type": "boolean", "default": True},
            "folder": {"type": "string", "minLength": 1, "x-sprisk-local-path": True,
                       "x-sprisk-asset-root": "audio"},
        },
    }  # fmt: skip


def test_a_cell_passes_other_inputs_by_name_and_leaves_out_an_unconnected_one() -> None:
    write = source_cell(authored_clean.fill_gaps)
    outputs = {"train": "a", "test": "b", "evidence": "e"}
    settings = {"columns": ["x"], "method": "mean"}

    linked = write(settings, {"train": "tr", "test": "te", "words": "w"}, outputs)
    alone = write(settings, {"train": "tr", "test": "te"}, outputs)

    assert linked.endswith("a, b, e = fill_gaps(tr, te, words=w, columns=['x'], method='mean')\n")
    assert alone.endswith("a, b, e = fill_gaps(tr, te, columns=['x'], method='mean')\n")
