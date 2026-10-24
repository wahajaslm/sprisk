from typing import Any


def decide(ctx: Any) -> Any:
    if ctx.bound("common.item_identity"):
        # Title groups would take the place of the stated item, and its rows could then land
        # on both sides of the split.
        return ctx.choose("stated_items", stated(ctx.evidence("data.identity_frequency")))
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


def stated(found: Any) -> str:
    reason = "The question names the column that says which item each row is."
    if found is None:
        return reason
    if found["repeated_items"] == 0:
        reason += " No two rows share an item."
    else:
        reason += (
            f" {found['rows_in_repeated']} of {found['rows']} rows share an item with another "
            f"row ({found['repeated_items']} items, largest {found['largest_item']})."
        )
    if found["missing"]:
        reason += (
            f" {found['missing']} rows have no item identifier; the item split refuses them "
            "until they are filled or dropped."
        )
    return reason
