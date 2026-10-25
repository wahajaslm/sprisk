from typing import Any

from sprisk_workers.errors import MethodError

RANDOM = ("stratified_random", "simple_random")


def decide(ctx: Any) -> Any:
    option, why = _preferred(ctx)
    failed = ctx.ruled_out(option)
    if failed is None:
        return ctx.choose(option, why)
    # Only rows repeated across a random split have a remedy: keep each item on one side.
    if option not in RANDOM or ctx.ruled_out("item_groups") is not None:
        raise MethodError(f"No split left keeps its promise on these rows: {failed}")
    # Rows repeat across train and test: only keeping each item on one side makes the score fair.
    return ctx.ask(
        "item_groups",
        f"The split broke its promise: {failed} State the question's item column, the one that "
        "says which item each row is, so each item's rows stay on one side.",
    )


def _preferred(ctx: Any) -> tuple[str, str]:
    if ctx.bound("common.event_time"):
        return (
            "temporal",
            "A time column orders the rows: train on earlier rows, test on later ones. The split "
            "leaves no gap at the cutoff, so a label that looks ahead may share its window "
            "with the first test rows.",
        )
    if ctx.bound("common.item_identity"):
        return (
            "item_groups",
            "Rows of one item stay on one side, so no item is scored on rows the model saw.",
        )
    if ctx.task == "classification" and ctx.bound("common.target"):
        return (
            "stratified_random",
            "Every row is its own item, and each class keeps its share in train and test.",
        )
    return "simple_random", "Every row is its own item."


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


def verify_no_row_in_both(evidence: dict[str, Any], settings: dict[str, Any]) -> tuple[str, str]:
    if evidence["in_both"]:
        return "fail", (
            f"{evidence['in_both']} test rows have the same features as a train row: the model "
            "is scored on rows it learned. Treat repeated rows as one item."
        )
    return "pass", f"No test row repeats a train row ({evidence['test_rows']} test rows)."


def verify_test_after_train(evidence: dict[str, Any], settings: dict[str, Any]) -> tuple[str, str]:
    latest = evidence["latest_train"]
    if evidence["not_later_test_rows"]:
        return "fail", f"{evidence['not_later_test_rows']} test rows are not later than {latest}."
    return "pass", f"Every test row is later than {latest}, the latest train row."
