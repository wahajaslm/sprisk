"""Whether a date reaching a model is split into parts first (ADR-0063 slice 6)."""

from method_harness import decide

METHOD = "supervised/date_parts"
ORDER = {"features.text_representation": "no_free_text"}


def test_a_date_is_split_into_parts() -> None:
    d = decide(METHOD, evidence={"features.dates": {"columns": ["day"]}}, decisions=ORDER)
    assert (d["outcome"], d["option"]) == ("choose", "date_parts")
    assert d["reason"].startswith("day: a date would reach the model")


def test_no_date_needs_no_step() -> None:
    d = decide(METHOD, evidence={"features.dates": {"columns": []}}, decisions=ORDER)
    assert (d["outcome"], d["option"]) == ("choose", "no_dates")


def test_unmeasured_columns_need_no_step_and_it_says_why() -> None:
    d = decide(METHOD, decisions=ORDER)
    assert (d["outcome"], d["option"]) == ("choose", "no_dates")
    assert "not measured" in d["reason"]
