"""One recording listed twice is one item: copies are dropped before the split (ADR-0066)."""

from method_harness import decide

METHOD = "audio/same_recording"


def _copies(copies: int, rows: int = 120) -> dict[str, dict[str, int]]:
    return {"audio.recording_copies": {
        "rows": rows, "hashed": rows, "missing": 0, "unreadable": 0,
        "copies": copies, "groups": min(copies, 1), "largest_group": 2 if copies else 1,
    }}


def test_no_copies_keep_every_row() -> None:
    d = decide(METHOD, evidence=_copies(0))
    assert (d["outcome"], d["option"]) == ("choose", "keep")


def test_a_few_copies_are_dropped_before_the_split() -> None:
    d = decide(METHOD, evidence=_copies(1))
    assert (d["outcome"], d["option"]) == ("choose", "drop")
    assert "1 of 120 rows" in d["reason"]


def test_many_copies_ask_a_person_whether_they_are_meant() -> None:
    d = decide(METHOD, evidence=_copies(12))
    assert (d["outcome"], d["option"]) == ("ask", "keep")
