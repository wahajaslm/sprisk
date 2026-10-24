from typing import Any


def decide(ctx: Any) -> Any:
    found = ctx.evidence("data.spelling_variants")
    if found is None:
        return ctx.choose("keep", "Text spelling was not measured, so text stays as typed.")
    left = []
    if found["identifier_like"]:
        left.append(
            f"{', '.join(found['identifier_like'])} differ only in spaces or case, but each "
            "column identifies rows, so its values stay as typed: merging two could merge two "
            "items."
        )
    if found["accent_only"]:
        left.append(
            f"{', '.join(found['accent_only'])} differ only in accents, which can carry "
            "meaning, so they stay as typed."
        )
    if found["columns"]:
        reason = (
            f"{', '.join(found['columns'])}: values differ only in spaces or case, so one "
            "category is typed several ways."
        )
        return ctx.choose("normalise", " ".join([reason, *left]))
    return ctx.choose("keep", " ".join(["No category text is typed several ways.", *left]))
