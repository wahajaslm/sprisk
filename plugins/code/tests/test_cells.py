import json

from sprisk_code.cells import split_cells
from sprisk_contracts import CodeSplit

LOAD = 'import pandas as pd\ndf = pd.read_csv("customers.csv")'
FILTER = 'min_age = 18\nfiltered = df[df["age"] >= min_age]\nprint(len(filtered))'
SUMMARY = "summary = filtered.describe()\nsummary"


def links(split: CodeSplit) -> list[tuple[int, int, str]]:
    return [(link.from_step, link.to_step, link.name.root) for link in split.links]


def cells(split: CodeSplit) -> list[list[int]]:
    return [[c.root for c in s.cells] for s in split.steps]


def names(ports: list) -> list[str]:  # type: ignore[type-arg]
    return [p.root for p in ports]


def test_three_cells_become_three_linked_steps() -> None:
    split = split_cells([LOAD, FILTER, SUMMARY])
    assert cells(split) == [[0], [1], [2]]
    assert links(split) == [(0, 1, "df"), (1, 2, "filtered")]
    assert [names(s.outputs) for s in split.steps] == [["df"], ["filtered"], []]
    assert [names(s.inputs) for s in split.steps] == [[], ["df"], ["filtered"]]
    assert split.steps[2].source == SUMMARY
    assert split.notes == []


def test_a_cell_of_imports_is_copied_where_it_is_used() -> None:
    split = split_cells(
        ["import pandas as pd\nimport numpy as np", "df = pd.DataFrame({'a': [1]})"]
    )
    [step] = split.steps
    assert [c.root for c in step.cells] == [1]
    assert step.source.startswith("import pandas as pd\n")
    assert "numpy" not in step.source
    assert [n.message for n in split.notes] == [
        "cell 1 only imports; its imports are copied into the steps that use them"
    ]


def test_a_literal_is_copied_so_it_can_be_a_setting() -> None:
    split = split_cells(["seed = 42", "raw = make(seed)"])
    assert links(split) == []
    assert "seed = 42\n" in split.steps[1].source


def test_a_name_comes_from_the_latest_cell_that_sets_it() -> None:
    split = split_cells(["df = load()", "df = df.dropna()", "n = len(df)"])
    assert links(split) == [(0, 1, "df"), (1, 2, "df")]


def test_a_function_used_later_keeps_its_cells_together() -> None:
    split = split_cells(["def clean(t):\n    return t", "raw = load()", "out = clean(raw)"])
    [step] = split.steps
    assert [c.root for c in step.cells] == [0, 1, 2]
    assert any("clean is a function" in n.message for n in split.notes)


def test_a_name_that_cannot_be_a_port_keeps_its_cells_together() -> None:
    split = split_cells(["X_train = load()", "model = fit(X_train)"])
    [step] = split.steps
    assert [c.root for c in step.cells] == [0, 1]
    assert any("X_train cannot be passed" in n.message for n in split.notes)


def test_names_local_to_functions_and_comprehensions_are_not_inputs() -> None:
    split = split_cells(
        [
            "items = load()\noffset = compute()",
            "def shift(a):\n    return a + offset\nys = [shift(v) for v in items]",
        ]
    )
    assert sorted(names(split.steps[1].inputs)) == ["items", "offset"]


def test_a_name_no_earlier_cell_sets_is_noted() -> None:
    split = split_cells(["total = lookup + 1\ndisplay(total)"])
    assert [n.message for n in split.notes] == ["cell 1 reads lookup, which no earlier cell sets"]


def test_ipython_magics_become_comments() -> None:
    split = split_cells(["%matplotlib inline\n!pip install x\nvalue = 1"])
    source = split.steps[0].source
    assert "# %matplotlib inline" in source and "# !pip install x" in source
    assert split.notes == []


def test_a_cell_that_does_not_parse_is_kept_and_noted() -> None:
    split = split_cells(["x = (", "y = 1"])
    assert cells(split) == [[0], [1]]
    assert split.notes[0].cell == 0 and "does not parse" in split.notes[0].message


def test_empty_cells_are_skipped() -> None:
    split = split_cells(["", "  \n", "a = 1"])
    assert cells(split) == [[2]]


def test_the_api_runs_it_as_a_process_over_stdio() -> None:
    import subprocess
    import sys

    request = json.dumps({"cells": [LOAD, FILTER]})
    done = subprocess.run(
        [sys.executable, "-m", "sprisk_code.cells"],
        input=request,
        capture_output=True,
        text=True,
        check=True,
        timeout=30,
    )
    split = CodeSplit.model_validate_json(done.stdout)
    assert links(split) == [(0, 1, "df")]
