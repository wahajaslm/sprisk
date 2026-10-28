"""A file the build must refuse: it holds two methods."""

from authored_method import head_split

from sprisk_workers.authoring import method, option

OPTIONS = {"only": option("Only", head_split, when="always", condition="⊤")}


@method(
    id="first", decides="x.first", activity="Test", applies_when={}, options=OPTIONS, source="t"
)
def first(task: str) -> object:
    """First

    Which?

    None.
    """
    return method.choose("only", reason="Only one.")


@method(
    id="second", decides="x.second", activity="Test", applies_when={}, options=OPTIONS, source="t"
)
def second(task: str) -> object:
    """Second

    Which?

    None.
    """
    return method.choose("only", reason="Only one.")
