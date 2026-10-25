from typing import Any


def decide(ctx: Any) -> Any:
    found = ctx.evidence("target.shape")
    if found is not None and found["distinct"] != 2:
        return ctx.choose(
            "not_two_classes",
            f"The target has {found['distinct']} classes; costs per mistake are stated for two.",
        )
    costs = ctx.statement("costs")
    if costs is None:
        return ctx.ask(
            "equal",
            "State what missing the costly class costs and what a false alarm costs, or "
            "confirm they cost the same.",
        )
    if costs["false_negative"] == costs["false_positive"]:
        return ctx.choose("equal", "Missing a case and a false alarm cost the same.")
    return ctx.choose(
        "stated",
        f"Missing {costs['positive']} costs {costs['false_negative']:g}; a false alarm costs "
        f"{costs['false_positive']:g}.",
    )
