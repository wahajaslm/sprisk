"""Whether the same item appears in more than one row (ADR-0063): matching titles suggest it,
and a person confirms before anything relies on it."""

from method_harness import decide

METHOD = "common/repeated_items"
KIND = "data.near_duplicate_groups"


def groups(groups: int, rows_in_groups: int = 201) -> dict[str, dict[str, int]]:
    return {
        KIND: {"rows": 596, "groups": groups, "rows_in_groups": rows_in_groups, "largest_group": 4}
    }


def test_matching_titles_are_asked_about_never_assumed() -> None:
    d = decide(METHOD, evidence=groups(83), bound=["common.item_title"])
    assert (d["outcome"], d["option"]) == ("ask", "group_by_title")
    assert d["reason"].startswith("201 of 596 rows share a title")
    assert d["reason"].endswith("Are rows with matching titles the same item?")


def test_no_shared_title_makes_every_row_its_own_item() -> None:
    d = decide(METHOD, evidence=groups(0, 0), bound=["common.item_title"])
    assert (d["outcome"], d["option"]) == ("choose", "independent_rows")


def test_with_no_title_column_rows_are_their_own_items_and_the_reason_says_why() -> None:
    d = decide(METHOD)
    assert (d["outcome"], d["option"]) == ("choose", "independent_rows")
    assert "No column is named as the item's title" in d["reason"]


def test_a_stated_item_column_is_kept_and_titles_never_replace_it() -> None:
    # Grouping by title would bind the item to the title groups and drop the stated column:
    # rows of one stated item could then land on both sides.
    d = decide(METHOD, evidence=groups(83), bound=["common.item_title", "common.item_identity"])
    assert (d["outcome"], d["option"]) == ("choose", "stated_items")


def frequency(missing: int = 0, repeated: int = 40) -> dict[str, dict[str, int]]:
    return {
        "data.identity_frequency": {
            "rows": 1000,
            "items": 700,
            "repeated_items": repeated,
            "rows_in_repeated": 230 if repeated else 0,
            "largest_item": 9 if repeated else 1,
            "missing": missing,
        }
    }


def test_a_stated_item_column_reports_how_many_rows_share_an_item() -> None:
    d = decide(METHOD, evidence=frequency(), bound=["common.item_identity"])
    assert (d["outcome"], d["option"]) == ("choose", "stated_items")
    assert "230 of 1000 rows share an item with another row (40 items, largest 9)" in d["reason"]


def test_rows_with_no_identifier_are_named_because_the_item_split_refuses_them() -> None:
    d = decide(METHOD, evidence=frequency(missing=12), bound=["common.item_identity"])
    assert (d["outcome"], d["option"]) == ("choose", "stated_items")
    assert "12 rows have no item identifier" in d["reason"]
