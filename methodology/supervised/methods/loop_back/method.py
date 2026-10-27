from typing import Any

LABEL = {
    "balanced_accuracy": "balanced accuracy",
    "expected_cost": "expected cost",
    "rmse": "RMSE",
    "weighted_f1": "weighted F1",
}
LOWER_IS_BETTER = {"expected_cost", "rmse"}


def decide(ctx: Any) -> Any:
    found = ctx.evidence("models.comparison")
    metric, score, looks = found["metric"], found["score"], found["looks"]
    name = LABEL[metric]
    if not found["beats_baseline"]:
        # Changing the features until a test passes would fish for a lift.
        return ctx.choose(
            "stop",
            f"No model beats the baseline's {name} of {found['baseline_score']:.3g}: stop and "
            "report no lift for these models and features.",
        )
    bar = ctx.statement("success_bar")
    if bar is None or bar["metric"] != metric:
        stated = "" if bar is None else f" It is stated in {LABEL[bar['metric']]}."
        return ctx.ask(
            "proceed",
            f"State the success bar as a {name} score: the models were compared by it.{stated}",
        )
    target = bar["score"]
    meets = score <= target if metric in LOWER_IS_BETTER else score >= target
    if meets:
        return ctx.choose(
            "proceed",
            f"The model's {name} of {score:.3g} meets the bar of {target:g}. It was chosen on "
            "these folds, so this score is optimistic: score the test rows once for the honest "
            "number.",
        )
    most = ctx.limit("max_looks")
    missed = f"The model's {name} of {score:.3g} misses the bar of {target:g}"
    if looks >= most:
        return ctx.choose(
            "stop",
            f"{missed}, after {looks} looks at the same folds: stop and report it as it stands.",
        )
    return ctx.choose(
        "reopen",
        f"{missed}: change the features, then compare the models again ({looks} of {most} "
        "looks taken).",
    )
