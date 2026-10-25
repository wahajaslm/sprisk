from typing import Any


def decide(ctx: Any) -> Any:
    found = ctx.evidence("features.encoding")
    if found is None:
        return ctx.choose("keep", "Categories were not measured, so every column stays.")
    if found["many"]:
        return ctx.choose(
            "leave_out",
            f"{', '.join(found['many'])}: more than 15 categories, too many for one 0/1 column "
            "each, and no step turns them into numbers yet. The model does not read them.",
        )
    return ctx.choose("keep", "No category column is too wide for one-hot encoding.")
