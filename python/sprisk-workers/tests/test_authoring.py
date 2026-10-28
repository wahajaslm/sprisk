"""A decorated operator compiles to a contract-valid manifest, its notebook cell is its own
code, and the build finds stale output (ADR-0071)."""

import sys
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import authored_ops
import polars as pl
import pytest
from authored_ops import every_nth
from polars.testing import assert_frame_equal

from sprisk_workers.authoring import operator
from sprisk_workers.build_packs import compile_packs, main, operator_manifest, stale
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
            "order_column": {"type": "string", "minLength": 1, "x-sprisk-column": True},
            "every": {"type": "integer", "minimum": 2, "maximum": 10, "x-sprisk-step": 1,
                      "default": 2},
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

from sprisk_workers.authoring import operator


@operator(id="first_rows", inputs=["data"], outputs=["out"], role="split", folds="plain")
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
    assert list(written) == [path]
    assert written[path].startswith("# Method IR compiled from acme_pack.first_rows:first_rows.")
    assert "id: acme.pack.first_rows@1.0.0" in written[path]


def test_stale_lists_missing_changed_and_orphaned_manifests(pack: Path) -> None:
    written = compile_packs([pack], trusted=("acme_pack",))
    path = next(iter(written))
    assert stale(written, [pack]) == [path]

    path.parent.mkdir(parents=True)
    path.write_text(written[path])
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

    with pytest.raises(ManifestError, match="two operators have the id first_rows"):
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
