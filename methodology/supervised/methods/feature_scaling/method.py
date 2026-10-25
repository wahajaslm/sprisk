from typing import Any


def decide(ctx: Any) -> Any:
    found = ctx.evidence("features.scaling")
    if found is None:
        return ctx.choose("no_scaling", "Numbers were not measured, so no step is added.")
    if not found["columns"]:
        return ctx.choose("no_scaling", "No number, other than 0/1, varies enough to scale.")
    names = ", ".join(found["columns"])
    if found["heavy"]:
        return ctx.choose(
            "robust_scaling",
            f"{names}: some have heavy tails or many outliers, so the median and IQR describe "
            "their spread better than the mean and SD.",
        )
    return ctx.choose(
        "z_score_scaling", f"{names}: light tails, so the mean and SD describe their spread."
    )
