from typing import Any


def decide(ctx: Any) -> Any:
    found = ctx.evidence("features.categories")
    if found is None:
        return ctx.choose("keep_categories", "Categories were not measured, so none is grouped.")
    named = (
        [
            f"Left alone: {', '.join(found['identifiers'])}, its own value for most train rows, "
            "so an identifier, not a category."
        ]
        if found["identifiers"]
        else []
    )
    if found["grouped"]:
        reason = (
            f"{', '.join(found['grouped'])}: more than 15 categories, too many for one 0/1 "
            'column each. Rare ones become "other", counted on the train rows.'
        )
        return ctx.choose("group_rare", " ".join([reason, *named]))
    return ctx.choose(
        "keep_categories", " ".join(["No category column has more than 15 categories.", *named])
    )
