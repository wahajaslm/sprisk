from typing import Any

# Rows below which a column with a different value in every row may be so by chance. A project
# convention.
MIN_ROWS = 100


def decide(ctx: Any) -> Any:
    found = ctx.evidence("data.identifiers")
    if found is None:
        return ctx.choose("keep_all", "Column roles were not measured, so every column stays.")
    if not found["columns"]:
        return ctx.choose(
            "keep_all", "No column has a different whole number or one-word code in every row."
        )
    named = ", ".join(found["columns"])
    if not found["features_left"]:
        return ctx.ask(
            "keep_all",
            f"Leaving out {named} leaves no column to learn from: say which ones only name rows.",
        )
    if found["rows"] < MIN_ROWS:
        return ctx.choose(
            "keep_all",
            f"{named} differ in every one of only {found['rows']} rows, which may be chance, so "
            "they stay.",
        )
    return ctx.choose(
        "drop_identifiers",
        f"{named} hold a different value in every row: they name rows, so they are left out.",
    )
