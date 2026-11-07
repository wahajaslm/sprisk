"""Audio recordings are grouped by who made them before the split is chosen (ADR-0066)."""

from method_harness import decide

METHOD = "audio/recording_group"


def test_a_stated_maker_keeps_each_maker_on_one_side() -> None:
    d = decide(METHOD, bound=["common.item_identity"])
    assert (d["outcome"], d["option"]) == ("choose", "maker_groups")


def test_without_a_stated_maker_a_person_is_asked_before_the_split() -> None:
    d = decide(METHOD, bound=[])
    assert (d["outcome"], d["option"]) == ("ask", "maker_groups")
    assert "who made each recording" in d["reason"]
