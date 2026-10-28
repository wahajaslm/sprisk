from typing import Any

# Train rows below which a forest is left off: a sprisk default, not a published law.
MIN_ROWS_FOR_FOREST = 100

SIMPLE = ["ml_dummy_baseline", "ml_linear_model"]


def decide(ctx: Any) -> Any:
    counted = ctx.evidence("data.train_rows")
    if ctx.statement("interpretability") == "high":
        return ctx.compare(
            SIMPLE,
            "The question needs a person to follow each prediction, and no one can follow a "
            "forest's, so the baseline and the linear model are compared.",
        )
    if counted is None:
        return ctx.compare(
            SIMPLE,
            "The train rows were not counted, so the forest is left off and the two simple "
            "models are compared.",
        )
    rows = counted["rows"]
    if rows < MIN_ROWS_FOR_FOREST:
        return ctx.compare(
            SIMPLE,
            f"{rows} train rows are below sprisk's default of {MIN_ROWS_FOR_FOREST} for a "
            "forest, so the baseline and the linear model are compared.",
        )
    return ctx.compare(
        [*SIMPLE, "ml_random_forest"],
        f"With {rows} train rows a forest is compared beside the baseline and the linear model.",
    )
