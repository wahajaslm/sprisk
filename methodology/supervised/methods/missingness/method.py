from typing import Any


def decide(ctx: Any) -> Any:
    found = ctx.evidence("features.gaps")
    if found is None:
        return ctx.choose("no_gaps", "Gaps were not measured, so no step is added.")
    left = []
    if found["unfillable"]:
        left.append(
            f"{', '.join(found['unfillable'])} has gaps, and the impute step fills numbers and "
            "text only."
        )
    if found["mostly_empty"]:
        left.append(
            f"{', '.join(found['mostly_empty'])} is at least 60% empty, so most of it would be "
            "made up: it is not filled."
        )
    if found["columns"]:
        reason = (
            f"{', '.join(found['columns'])} have gaps the model would refuse: numbers get the "
            f"train rows' {found['method']}, text gets its own value."
        )
        return ctx.choose("fill_before_model", " ".join([reason, *left]))
    if left:
        return ctx.choose("gaps_left", " ".join(left))
    return ctx.choose("no_gaps", "No column the model reads has gaps.")
