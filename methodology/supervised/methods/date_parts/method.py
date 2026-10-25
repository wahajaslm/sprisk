from typing import Any


def decide(ctx: Any) -> Any:
    found = ctx.evidence("features.dates")
    if found is None:
        return ctx.choose("no_dates", "Dates were not measured, so no step is added.")
    if found["columns"]:
        return ctx.choose(
            "date_parts",
            f"{', '.join(found['columns'])}: a date would reach the model, which reads only "
            "numbers.",
        )
    return ctx.choose("no_dates", "No date reaches the model.")
