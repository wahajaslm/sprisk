from typing import Any


def decide(ctx: Any) -> Any:
    found = ctx.evidence("features.encoding")
    if found is None:
        return ctx.choose("no_encoding", "Categories were not measured, so no step is added.")
    notes = (
        [
            f"{', '.join(found['codes'])}: whole numbers with few values, read as amounts. If "
            "they are category codes, their order and steps are invented."
        ]
        if found["codes"]
        else []
    )
    if found["few"]:
        reason = (
            f"{', '.join(found['few'])}: at most 15 categories each, so one 0/1 column per "
            "category stays small and invents no order."
        )
        return ctx.choose("one_hot_encoding", " ".join([reason, *notes]))
    return ctx.choose(
        "no_encoding", " ".join(["Every column the model reads is a number.", *notes])
    )
