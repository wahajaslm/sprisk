from typing import Any

# Splits whose rows are shuffled, as the inner folds that pick the threshold are.
SHUFFLED = ("stratified_random", "simple_random")


def decide(ctx: Any) -> Any:
    found = ctx.evidence("target.shape")
    if found is None or found["distinct"] != 2:
        return ctx.choose(
            "default_half", "Only a two-class question has a decision threshold to move."
        )
    costs = ctx.decision("question.error_costs")
    if costs not in ("stated", "equal"):
        return ctx.choose("default_half", "No costs are stated, so it predicts the likelier class.")
    if ctx.decision("split.method") not in SHUFFLED:
        return ctx.choose(
            "default_half",
            "The split keeps time order or whole items, and the inner folds that pick the "
            "threshold shuffle rows, so it predicts the likelier class.",
        )
    if costs == "equal":
        return ctx.choose(
            "cost_optimal_threshold",
            "Both mistakes cost the same, so the cheapest threshold is one half; the costs go on "
            "the model so models are compared by expected cost, as the question states.",
        )
    return ctx.choose(
        "cost_optimal_threshold",
        "The stated costs differ, so the model predicts at the threshold that costs least on "
        "its training rows.",
    )
