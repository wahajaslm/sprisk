from typing import Any


def decide(ctx: Any) -> Any:
    if ctx.bound("common.event_time"):
        return ctx.choose(
            "temporal",
            "A time column orders the rows: train on earlier rows, test on later ones. The split "
            "leaves no gap at the cutoff, so a label that looks ahead may share its window "
            "with the first test rows.",
        )
    if ctx.bound("common.item_identity"):
        return ctx.choose(
            "item_groups",
            "Rows of one item stay on one side, so no item is scored on rows the model saw.",
        )
    if ctx.task == "classification" and ctx.bound("common.target"):
        return ctx.choose(
            "stratified_random",
            "Every row is its own item, and each class keeps its share in train and test.",
        )
    return ctx.choose("simple_random", "Every row is its own item.")


def verify_no_group_overlap(evidence: dict[str, Any], settings: dict[str, Any]) -> tuple[str, str]:
    if evidence["train_groups"] == 0 or evidence["test_groups"] == 0:
        return "inconclusive", "One side has no groups."
    if evidence["overlapping"]:
        shown = ", ".join(evidence["overlapping_groups"][:5])
        return "fail", f"{evidence['overlapping']} items have rows in both train and test: {shown}"
    return "pass", (
        f"No item is in both sides ({evidence['train_groups']} train, "
        f"{evidence['test_groups']} test items)."
    )


def verify_class_shares_kept(evidence: dict[str, Any], settings: dict[str, Any]) -> tuple[str, str]:
    gap = evidence["largest_gap"]
    # One row more or less moves a class's share by 1/test_rows: drift that small is rounding.
    allowed = max(settings["max_gap"], 1 / evidence["test_rows"])
    if gap > allowed:
        return "fail", f"A class's share differs by {gap:.1%} between train and test."
    return "pass", f"Class shares differ by at most {gap:.1%} between train and test."
