from typing import Any


def decide(ctx: Any) -> Any:
    found = ctx.evidence("data.html_text")
    if found is None:
        return ctx.choose("keep", "HTML was not measured, so text stays as it is.")
    note = (
        [f"{', '.join(found['held'])} also holds HTML, but a key column is left as it is."]
        if found["held"]
        else []
    )
    if found["columns"]:
        reason = (
            f"{', '.join(found['columns'])}: values hold HTML tags or entities, which would be "
            "read as words."
        )
        return ctx.choose("strip", " ".join([reason, *note]))
    return ctx.choose("keep", " ".join(["No feature column holds HTML.", *note]))
