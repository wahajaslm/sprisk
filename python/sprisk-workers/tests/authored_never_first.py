"""A method the build must refuse: one option is never chosen."""

from authored_method import head_split, time_split

from sprisk_workers.authoring import method, option

OPTIONS = {
    "by_time": option("By time", time_split, when="a time column", condition="time"),
    "first_rows": option("First rows", head_split, when="otherwise", condition="¬ time"),
}


@method(
    id="never_first",
    decides="split.never",
    activity="Test",
    applies_when={},
    options=OPTIONS,
    source="test",
)
def never_first(task: str) -> object:
    """Never first

    Which?

    No pitfall worth naming.
    """
    return method.choose("by_time", reason="Always by time.")
