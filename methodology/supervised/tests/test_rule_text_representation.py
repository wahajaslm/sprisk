from typing import Any

import pytest
from rule_harness import alternative, column, decide, manifest

from sprisk_workers.errors import RuleError

RULE = "supervised/text_representation"
SETTINGS = {"high_cardinality_threshold": 15, "free_text_word_share": 0.5}


def run(profile: dict[str, object]) -> dict[str, Any]:
    return decide(RULE, profile=profile, settings=SETTINGS)


def test_free_text_becomes_words_learnt_from_the_train_rows() -> None:
    d = run(
        {
            **column("designation", "String", distinct=740, word_share=1.0),
            **column("description", "String", distinct=480, word_share=0.9),
            **column("price", "Float64", distinct=300),
        }
    )
    assert d["recommended_alternative_id"] == "vectorize_words"
    assert alternative(d, "vectorize_words")["params"] == {
        "columns": ["description", "designation"]
    }
    assert alternative(d, "no_free_text")["applicability"] == "not_applicable"
    assert {
        "kind": "profile_fact",
        "label": "designation values holding several words",
        "value": "100%",
        "origin": "measured",
    } in d["evidence"]


def test_many_one_word_codes_are_categories_not_free_text() -> None:
    d = run(column("city", "String", distinct=120, word_share=0.05))
    assert d["recommended_alternative_id"] == "no_free_text"
    assert alternative(d, "vectorize_words")["applicability"] == "not_applicable"
    assert "city" in alternative(d, "no_free_text")["reason"]


def test_a_few_multi_word_values_are_categories_for_one_hot() -> None:
    d = run(column("region", "String", distinct=6, word_share=1.0))
    assert d["recommended_alternative_id"] == "no_free_text"


def test_a_text_column_with_no_values_has_nothing_to_learn_and_says_so() -> None:
    d = run(column("notes", "String", distinct=0))
    assert d["recommended_alternative_id"] == "no_free_text"
    assert "notes has no values" in alternative(d, "no_free_text")["reason"]
    assert all("several words" not in e["label"] for e in d["evidence"])


def test_an_unmeasured_word_share_is_an_error_not_zero() -> None:
    with pytest.raises(RuleError, match="word_share"):
        run(column("designation", "String", distinct=740))


@pytest.mark.parametrize(
    ("distinct", "share", "picks"),
    [(16, 0.5, "vectorize_words"), (15, 1.0, "no_free_text"), (16, 0.49, "no_free_text")],
)
def test_free_text_starts_past_one_hots_limit_at_half_the_values(
    distinct: int, share: float, picks: str
) -> None:
    d = run(column("title", "String", distinct=distinct, word_share=share))
    assert d["recommended_alternative_id"] == picks


def test_the_limit_is_the_one_categorical_encoding_one_hot_encodes_up_to() -> None:
    # Text over it that is not free text goes to rare categories, then one-hot.
    encoding = manifest("supervised/categorical_encoding")["policy_thresholds"]
    ours = manifest(RULE)["policy_thresholds"]
    assert ours["high_cardinality_threshold"] == encoding["high_cardinality_threshold"]


def test_numbers_alone_have_no_text() -> None:
    d = run(column("price", "Float64", distinct=300))
    assert d["recommended_alternative_id"] == "no_free_text"
    assert alternative(d, "no_free_text")["reason"] == "No text column reaches the model."


def test_characters_and_embeddings_are_not_built_yet() -> None:
    d = run(column("designation", "String", distinct=740, word_share=1.0))
    for later in ("tfidf_chars", "local_embeddings"):
        assert alternative(d, later)["applicability"] == "not_applicable"
