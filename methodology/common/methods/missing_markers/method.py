from typing import Any


def decide(ctx: Any) -> Any:
    found = ctx.evidence("data.missing_markers")
    if found is None:
        return ctx.choose("keep", "Placeholders were not measured, so values stay as typed.")
    left = []
    if found["unknown"]:
        left.append(
            f"{'; '.join(found['unknown'])}: each may be a real value ('NA' is a country "
            "code), so it stays as typed."
        )
    if found["columns"]:
        shown = ", ".join(repr(v) for v in found["values"])
        reason = (
            f"{', '.join(found['columns'])}: mostly numbers, with placeholders {shown} that "
            "stand for a gap."
        )
        return ctx.choose("mark", " ".join([reason, *left]))
    return ctx.choose("keep", " ".join(["No number column holds a known placeholder.", *left]))
