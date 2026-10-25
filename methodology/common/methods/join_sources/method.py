from typing import Any


def decide(ctx: Any) -> Any:
    found = ctx.evidence("data.join_keys")
    # Measured only when exactly one loaded table is read by no step; the walk names several.
    if found is None:
        return ctx.choose(
            "single_source",
            "No one loaded table stands apart that no step reads, so none is joined.",
        )
    shared, key, rows = found["shared"], found["key"], found["rows"]
    if not shared:
        return ctx.ask(
            "single_source",
            "The tables share no column: say which columns say which rows belong together.",
        )
    if not key:
        return ctx.ask(
            "single_source",
            f"Both tables have {', '.join(shared)}: say which is the key; the others would clash.",
        )
    if found["most_rows_per_key"] > 1:
        return ctx.ask(
            "single_source",
            f"One value of {key} finds {found['most_rows_per_key']} rows of the other table, so "
            "joining would copy rows.",
        )
    if found["matched_rows"] < rows:
        return ctx.ask(
            "single_source",
            f"{rows - found['matched_rows']} of {rows} rows find no match on {key}, so they would "
            "join with gaps, such as a missing label. Say whether the key or the files are wrong.",
        )
    if ctx.bound("common.event_time"):
        return ctx.ask(
            "join_on_key",
            f"Every row finds one match on {key}, but the question is over time: confirm the "
            "other table holds only what was known at prediction time.",
        )
    return ctx.choose(
        "join_on_key",
        f"Every one of the {rows} rows finds exactly one row of the other table on {key}.",
    )
