"""Whether a classification target's class mix is unbalanced (ADR-0063 slice 6): its rarest
class against the share an even class would hold, for any number of classes."""

from method_harness import decide

METHOD = "common/class_balance"


def shape(distinct: int, rarest: float) -> dict[str, dict[str, object]]:
    return {
        "target.shape": {
            "rows": 1000,
            "distinct": distinct,
            "numeric": True,
            "whole_numbers": True,
            "rarest_share": rarest,
        }
    }


def test_twenty_seven_classes_with_a_rare_one_are_unbalanced() -> None:
    # Even, each would hold 3.7%; a fifth of that is 0.74%.
    d = decide(METHOD, evidence=shape(27, 0.0045), bound=["common.target"])
    assert (d["outcome"], d["option"]) == ("choose", "unbalanced")
    assert d["reason"].startswith("The rarest class holds 0.45% of train rows")


def test_fifteen_even_classes_are_balanced() -> None:
    d = decide(METHOD, evidence=shape(15, 0.066), bound=["common.target"])
    assert (d["outcome"], d["option"]) == ("choose", "balanced")


def test_an_unmeasured_target_is_said_to_be_unmeasured() -> None:
    d = decide(METHOD)
    assert (d["outcome"], d["option"]) == ("ask", "balanced")
