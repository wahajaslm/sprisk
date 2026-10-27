"""Great Expectations adapter for explicit data-quality rules.

The adapter deliberately receives rules from Sprisk rather than inferring a contract from the
table it validates. A profile describes data; a contract is an explicit expectation about it.
"""

from dataclasses import dataclass
from typing import Literal

import great_expectations as gx
import polars as pl
from great_expectations.core.expectation_validation_result import ExpectationValidationResult
from great_expectations.data_context.types.base import ProgressBarsConfig
from great_expectations.datasource.fluent.interfaces import Batch
from great_expectations.expectations.core.expect_column_values_to_not_be_null import (
    ExpectColumnValuesToNotBeNull,
)
from great_expectations.expectations.core.expect_column_values_to_not_match_regex import (
    ExpectColumnValuesToNotMatchRegex,
)

RuleKind = Literal["not_blank", "not_null"]


@dataclass(frozen=True)
class QualityRule:
    """One explicit quality expectation that may be evaluated against a table."""

    rule: RuleKind
    column: str
    required_share: float = 1.0

    def __post_init__(self) -> None:
        if not self.column:
            raise ValueError("quality rule column must not be empty")
        if not 0 < self.required_share <= 1:
            raise ValueError("quality rule required_share must be between 0 and 1")

    @classmethod
    def not_blank(cls, column: str, required_share: float = 1.0) -> "QualityRule":
        return cls("not_blank", column, required_share)

    @classmethod
    def not_null(cls, column: str, required_share: float = 1.0) -> "QualityRule":
        return cls("not_null", column, required_share)


@dataclass(frozen=True)
class QualityCheck:
    """The compact, framework-neutral result Sprisk can store and render."""

    rule: RuleKind
    column: str
    passed: bool
    rows: int
    unexpected: int
    unexpected_share: float


def validate(data: pl.DataFrame, rules: list[QualityRule]) -> list[QualityCheck]:
    """Evaluate explicit quality rules with Great Expectations.

    Polars remains the profile engine. The conversion is confined to this adapter until a
    native GX/Arrow path is justified by a production-scale use case.
    """
    if not rules:
        return []
    batch = _batch(data)
    return [_check(rule, _validate(batch, rule)) for rule in rules]


def _batch(data: pl.DataFrame) -> Batch:
    context = gx.get_context(mode="ephemeral")
    context.variables.progress_bars = ProgressBarsConfig(globally=False)
    source = context.data_sources.add_pandas("sprisk")
    asset = source.add_dataframe_asset("profile")
    definition = asset.add_batch_definition_whole_dataframe("all_rows")
    return definition.get_batch(batch_parameters={"dataframe": data.to_pandas()})


def _validate(batch: Batch, rule: QualityRule) -> ExpectationValidationResult:
    if rule.rule == "not_null":
        return batch.validate(
            ExpectColumnValuesToNotBeNull(column=rule.column, mostly=rule.required_share)
        )
    return batch.validate(
        ExpectColumnValuesToNotMatchRegex(
            column=rule.column,
            regex=r"^\s*$",
            mostly=rule.required_share,
        )
    )


def _check(rule: QualityRule, result: ExpectationValidationResult) -> QualityCheck:
    details = result.result
    rows = details.get("element_count")
    unexpected = details.get("unexpected_count")
    if not isinstance(rows, int) or not isinstance(unexpected, int):
        raise ValueError(f"Great Expectations could not evaluate {rule.rule} for {rule.column}")
    return QualityCheck(
        rule=rule.rule,
        column=rule.column,
        passed=result.success is True,
        rows=rows,
        unexpected=unexpected,
        unexpected_share=0.0 if rows == 0 else unexpected / rows,
    )
