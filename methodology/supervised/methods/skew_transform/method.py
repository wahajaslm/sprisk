from typing import Any


def decide(ctx: Any) -> Any:
    found = ctx.evidence("features.skew")
    if found is None:
        return ctx.choose("no_transform", "Numbers were not measured, so no step is added.")
    if found["columns"]:
        return ctx.choose(
            "yeo_johnson",
            f"{', '.join(found['columns'])}: skewness past 1.0, a long tail that lets a few "
            "large values pull a linear fit. The transform keeps order, so trees lose nothing.",
        )
    return ctx.choose("no_transform", "No number, other than 0/1, has a long tail.")
