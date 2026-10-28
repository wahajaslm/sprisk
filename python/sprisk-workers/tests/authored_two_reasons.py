"""A method the build must refuse: one option has two reasons."""

from authored_method import head_split, time_split

from sprisk_workers.authoring import method, option

OPTIONS = {
    "by_time": option("By time", time_split, when="a time column", condition="time"),
    "first_rows": option("First rows", head_split, when="otherwise", condition="¬ time"),
}


@method(
    id="two_reasons",
    decides="split.two",
    activity="Test",
    applies_when={},
    options=OPTIONS,
    source="test",
)
def two_reasons(task: str) -> object:
    """Two reasons

    Which?

    No pitfall worth naming.
    """
    if task == "classification":
        return method.choose("by_time", reason="One reason.")
    if task == "regression":
        return method.choose("by_time", reason="Another reason.")
    return method.choose("first_rows", reason="Fallback.")
