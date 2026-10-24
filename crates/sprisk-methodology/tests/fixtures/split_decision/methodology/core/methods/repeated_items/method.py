def decide(ctx):
    if ctx.bound("common.item_identity"):
        # Title groups would take the place of the stated item, and its rows could then land
        # on both sides of the split.
        return ctx.choose(
            "stated_items", "The question names the column that says which item each row is."
        )
    found = ctx.evidence("data.near_duplicate_groups")
    if found["groups"] == 0:
        return ctx.choose("independent_rows", "No two rows share a title.")
    # Matching titles are a proxy for "same item", so a person confirms before anything relies on it.
    return ctx.ask(
        "group_by_title",
        f"{found['rows_in_groups']} of {found['rows']} rows share a title with another row "
        f"({found['groups']} groups, largest {found['largest_group']}). "
        "Are rows with matching titles the same item?",
    )
