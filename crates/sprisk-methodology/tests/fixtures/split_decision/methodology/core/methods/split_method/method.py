def decide(ctx):
    if ctx.decision("data.repeated_items") == "group_by_title":
        return ctx.choose(
            "item_groups",
            "Rows of one item stay on one side, so no item is scored on rows the model saw.",
        )
    if ctx.question("task") == "classification":
        return ctx.choose(
            "stratified_random",
            "Every row is its own item, and each class keeps its share in train and test.",
        )
    return ctx.choose("simple_random", "Every row is its own item.")


def verify_no_group_overlap(evidence, settings):
    if evidence["train_groups"] == 0 or evidence["test_groups"] == 0:
        return "inconclusive", "One side has no groups."
    both = evidence["overlapping_groups"]
    if both:
        shown = ", ".join(str(g) for g in both[:5])
        return "fail", f"{len(both)} items have rows in both train and test: {shown}"
    return "pass", (
        f"No item is in both sides ({evidence['train_groups']} train, "
        f"{evidence['test_groups']} test items)."
    )


def verify_class_shares_kept(evidence, settings):
    gap = evidence["largest_gap"]
    if gap > settings["max_gap"]:
        return "fail", f"A class's share differs by {gap:.1%} between train and test."
    return "pass", f"Class shares differ by at most {gap:.1%} between train and test."
