from typing import Any


def decide(ctx: Any) -> Any:
    found = ctx.evidence("data.near_duplicate_groups")
    if found["groups"] == 0:
        return ctx.choose("independent_rows", "No two rows share a title.")
    # Matching titles only suggest "same item", so a person confirms before anything uses it.
    return ctx.ask(
        "group_by_title",
        f"{found['rows_in_groups']} of {found['rows']} rows share a title with another row "
        f"({found['groups']} groups, largest {found['largest_group']}). "
        "Are rows with matching titles the same item?",
    )
