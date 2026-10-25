"""The steps shaping a model's inputs after words and dates (ADR-0063 slice 6): rare
categories grouped, gaps filled, categories too wide left out, the rest one-hot encoded."""

from typing import Any

from method_harness import decide


def test_rare_categories_are_grouped_and_identifiers_named() -> None:
    found = {"features.categories": {"grouped": ["brand"], "identifiers": ["sku"]}}
    d = decide(
        "supervised/rare_categories",
        evidence=found,
        decisions={"features.date_parts": "no_dates"},
    )
    assert (d["outcome"], d["option"]) == ("choose", "group_rare")
    assert d["reason"].startswith("brand: more than 15 categories")
    assert "sku" in d["reason"]


def test_few_categories_need_no_grouping() -> None:
    found: dict[str, Any] = {"features.categories": {"grouped": [], "identifiers": []}}
    d = decide(
        "supervised/rare_categories", evidence=found, decisions={"features.date_parts": "no_dates"}
    )
    assert (d["outcome"], d["option"]) == ("choose", "keep_categories")


def gaps(columns: list[str], **left: list[str]) -> dict[str, Any]:
    return {
        "features.gaps": {
            "columns": columns,
            "method": "median",
            "mostly_empty": left.get("mostly_empty", []),
            "unfillable": left.get("unfillable", []),
        }
    }


GAPS_ORDER = {"features.rare_categories": "keep_categories"}


def test_gaps_the_model_would_refuse_are_filled_from_the_train_rows() -> None:
    d = decide("supervised/missingness", evidence=gaps(["price", "kind"]), decisions=GAPS_ORDER)
    assert (d["outcome"], d["option"]) == ("choose", "fill_before_model")
    assert d["reason"].startswith("price, kind have gaps the model would refuse")


def test_no_gaps_needs_no_step() -> None:
    d = decide("supervised/missingness", evidence=gaps([]), decisions=GAPS_ORDER)
    assert (d["outcome"], d["option"]) == ("choose", "no_gaps")


def test_gaps_no_step_can_fill_are_left_and_named() -> None:
    found = gaps([], unfillable=["day"], mostly_empty=["note"])
    d = decide("supervised/missingness", evidence=found, decisions=GAPS_ORDER)
    assert (d["outcome"], d["option"]) == ("choose", "gaps_left")
    assert "day" in d["reason"] and "note" in d["reason"]


def encoding(few: list[str], many: list[str], codes: list[str] | None = None) -> dict[str, Any]:
    return {"features.encoding": {"few": few, "many": many, "codes": codes or []}}


def test_categories_too_wide_for_one_hot_are_left_out() -> None:
    d = decide(
        "supervised/wide_categories",
        evidence=encoding(["colour"], ["sku"]),
        decisions={"cleaning.missingness_strategy": "no_gaps"},
    )
    assert (d["outcome"], d["option"]) == ("choose", "leave_out")
    assert d["reason"].startswith("sku: more than 15 categories")


def test_no_wide_category_keeps_every_column() -> None:
    d = decide(
        "supervised/wide_categories",
        evidence=encoding(["colour"], []),
        decisions={"cleaning.missingness_strategy": "no_gaps"},
    )
    assert (d["outcome"], d["option"]) == ("choose", "keep")


ENCODING_ORDER = {"features.wide_categories": "keep"}


def test_few_categories_get_one_column_each() -> None:
    d = decide(
        "supervised/categorical_encoding",
        evidence=encoding(["colour", "flag"], []),
        decisions=ENCODING_ORDER,
    )
    assert (d["outcome"], d["option"]) == ("choose", "one_hot_encoding")
    assert d["reason"].startswith("colour, flag: at most 15 categories each")


def test_numbers_only_need_no_encoding_and_possible_codes_are_named() -> None:
    d = decide(
        "supervised/categorical_encoding",
        evidence=encoding([], [], codes=["rate"]),
        decisions=ENCODING_ORDER,
    )
    assert (d["outcome"], d["option"]) == ("choose", "no_encoding")
    assert "rate" in d["reason"] and "codes" in d["reason"]


def test_unmeasured_inputs_add_no_step() -> None:
    for method, order in [
        ("supervised/rare_categories", {"features.date_parts": "no_dates"}),
        ("supervised/missingness", GAPS_ORDER),
        ("supervised/wide_categories", {"cleaning.missingness_strategy": "no_gaps"}),
        ("supervised/categorical_encoding", ENCODING_ORDER),
    ]:
        d = decide(method, decisions=order)
        assert d["outcome"] == "choose" and "not measured" in d["reason"], method


SKEW_ORDER = {"features.encoding_strategy": "no_encoding"}


def test_skewed_numbers_get_a_power_transform_whatever_the_model() -> None:
    found = {"features.skew": {"columns": ["income"]}}
    d = decide("supervised/skew_transform", evidence=found, decisions=SKEW_ORDER)
    assert (d["outcome"], d["option"]) == ("choose", "yeo_johnson")
    assert d["reason"].startswith("income: skewness past 1.0")


def test_no_skewed_number_needs_no_transform() -> None:
    found: dict[str, Any] = {"features.skew": {"columns": []}}
    d = decide("supervised/skew_transform", evidence=found, decisions=SKEW_ORDER)
    assert (d["outcome"], d["option"]) == ("choose", "no_transform")


SCALING_ORDER = {"features.skew_transform": "no_transform"}


def scaling(columns: list[str], heavy: bool) -> dict[str, Any]:
    return {"features.scaling": {"columns": columns, "heavy": heavy}}


def test_heavy_tails_get_robust_scaling() -> None:
    d = decide(
        "supervised/feature_scaling", evidence=scaling(["income"], True), decisions=SCALING_ORDER
    )
    assert (d["outcome"], d["option"]) == ("choose", "robust_scaling")
    assert "income" in d["reason"]


def test_light_tails_get_z_score_scaling() -> None:
    d = decide(
        "supervised/feature_scaling", evidence=scaling(["age"], False), decisions=SCALING_ORDER
    )
    assert (d["outcome"], d["option"]) == ("choose", "z_score_scaling")


def test_no_number_to_scale_needs_no_step() -> None:
    d = decide("supervised/feature_scaling", evidence=scaling([], False), decisions=SCALING_ORDER)
    assert (d["outcome"], d["option"]) == ("choose", "no_scaling")


def test_unmeasured_numbers_add_no_step() -> None:
    for method, order in [
        ("supervised/skew_transform", SKEW_ORDER),
        ("supervised/feature_scaling", SCALING_ORDER),
    ]:
        d = decide(method, decisions=order)
        assert d["outcome"] == "choose" and "not measured" in d["reason"], method
