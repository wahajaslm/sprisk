import polars as pl

from sprisk_profile.great_expectations import QualityRule, validate


def test_rakuten_quality_rules_become_small_typed_results() -> None:
    listings = pl.DataFrame(
        {
            "designation": ["lampe modele", "livre modele", "chaussure modele"],
            "description": ["lampe neuve", "", ""],
            "prdtypecode": [10, 20, 30],
        }
    )

    checks = validate(
        listings,
        [
            QualityRule.not_blank("description", required_share=0.8),
            QualityRule.not_null("prdtypecode"),
        ],
    )

    description, label = checks
    assert (description.rule, description.column, description.passed) == (
        "not_blank",
        "description",
        False,
    )
    assert (description.rows, description.unexpected, description.unexpected_share) == (3, 2, 2 / 3)
    assert (label.rule, label.column, label.passed) == ("not_null", "prdtypecode", True)
    assert (label.rows, label.unexpected, label.unexpected_share) == (3, 0, 0.0)
