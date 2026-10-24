from typing import Any


def decide(ctx: Any) -> Any:
    found = ctx.evidence("data.spelling_variants")
    if found and found["columns"]:
        return ctx.choose("normalise", "Category text is typed several ways.")
    return ctx.choose("keep", "No category text is typed several ways.")
