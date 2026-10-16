import ast

import pytest

from sprisk_code.discovery import bind, free_names, literal_parameters
from sprisk_workers.errors import OperatorError

CELL = """\
import polars as pl
threshold = 0.15
label = "ok"
use_log = True
depth = -3
cleaned = data.filter(pl.col("x") > threshold)
print(cleaned.height, lookup)
"""


def test_top_level_literal_assignments_are_parameter_candidates() -> None:
    found = [(p.name, p.line, p.value_type, p.default_text) for p in literal_parameters(CELL)]
    assert found == [
        ("threshold", 2, "number", "0.15"),
        ("label", 3, "string", "'ok'"),
        ("use_log", 4, "boolean", "True"),
        ("depth", 5, "integer", "-3"),
    ]


def test_a_name_assigned_twice_is_not_offered() -> None:
    source = "k = 1\nk = 2\nm = 3\n"
    assert [p.name for p in literal_parameters(source)] == ["m"]


def test_assignments_inside_functions_or_with_expressions_are_not_offered() -> None:
    source = "def f():\n    a = 1\nb = 1 + 2\nc, d = 1, 2\n"
    assert literal_parameters(source) == []


def test_free_names_are_read_but_never_defined() -> None:
    assert free_names(CELL) == ["data", "lookup"]


def test_names_from_functions_loops_and_comprehensions_are_not_free() -> None:
    source = (
        "def f(a):\n    return a\n"
        "for i in range(3):\n    pass\n"
        "sq = [v * v for v in range(i)]\nf(sq)\n"
    )
    assert free_names(source) == []


def test_bind_rewrites_a_copy_and_keeps_the_source() -> None:
    module = bind(CELL, {"threshold": 0.25, "label": "go"})
    text = ast.unparse(module)
    assert "threshold = 0.25" in text and "label = 'go'" in text
    assert "threshold = 0.15" in CELL


def test_binding_a_name_that_is_not_a_parameter_fails() -> None:
    with pytest.raises(OperatorError) as e:
        bind(CELL, {"cleaned": 1})
    assert e.value.code == "unknown_parameter" and "cleaned" in e.value.message


def test_binding_a_value_of_the_wrong_kind_fails() -> None:
    for wrong in ("yes", [1]):
        with pytest.raises(OperatorError) as e:
            bind(CELL, {"use_log": wrong})
        assert e.value.code == "invalid_parameter"


def test_files_the_code_reads_are_inputs_not_parameters() -> None:
    from sprisk_code.discovery import file_reads

    source = (
        'path = "data/penguins.csv"\n'
        "raw = pl.read_csv(path)\n"
        'extra = pl.read_parquet("lookup.parquet")\n'
        "with open('notes.txt') as f:\n    notes = f.read()\n"
        "rate = 0.5\n"
    )
    assert [(f.path, f.reader, f.line) for f in file_reads(source)] == [
        ("data/penguins.csv", "read_csv", 2),
        ("lookup.parquet", "read_parquet", 3),
        ("notes.txt", "open", 4),
    ]
    assert [p.name for p in literal_parameters(source)] == ["rate"]
