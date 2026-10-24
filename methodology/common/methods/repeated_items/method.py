from typing import Any


def decide(ctx: Any) -> Any:
    if ctx.bound("common.item_identity"):
        # Title groups would take the place of the stated item, and its rows could then land
        # on both sides of the split.
        return ctx.choose(
            "stated_items", "The question names the column that says which item each row is."
        )
    found = ctx.evidence("data.near_duplicate_groups")
    if found is None:
        return ctx.choose(
            "independent_rows",
            "No column is named as the item's title, so repeated items were not looked for: "
            "every row is taken as its own item.",
        )
    if found["groups"] == 0:
        return ctx.choose("independent_rows", "No two rows share a title.")
    # Matching titles only suggest "same item", so a person confirms before anything uses it.
    return ctx.ask(
        "group_by_title",
        f"{found['rows_in_groups']} of {found['rows']} rows share a title with another row "
        f"({found['groups']} groups, largest {found['largest_group']}). "
        "Are rows with matching titles the same item?",
    )
