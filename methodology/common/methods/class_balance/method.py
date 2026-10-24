from typing import Any

# The rarest class is unbalanced below this fraction of an even class's share: for two classes
# 10% of rows. A project default; He & Garcia give no single number.
MIN_SHARE_OF_EVEN = 0.2


def decide(ctx: Any) -> Any:
    found = ctx.evidence("target.shape")
    if found is None:
        return ctx.ask(
            "balanced", "The target was not measured on the train rows. Is one class rare?"
        )
    classes, rarest = found["distinct"], found["rarest_share"]
    even = 1 / classes
    bar = MIN_SHARE_OF_EVEN * even
    if rarest < bar:
        return ctx.choose(
            "unbalanced",
            f"The rarest class holds {rarest:.2%} of train rows, under {bar:.2%}: a fifth of the "
            f"{even:.1%} each of {classes} even classes would hold.",
        )
    return ctx.choose(
        "balanced", f"The rarest class holds {rarest:.2%} of train rows, at least {bar:.2%}."
    )
