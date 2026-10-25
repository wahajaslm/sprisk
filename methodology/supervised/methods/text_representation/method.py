from typing import Any


def decide(ctx: Any) -> Any:
    found = ctx.evidence("features.free_text")
    if found is None:
        return ctx.choose("no_free_text", "Text was not measured, so it is left as it is.")
    notes = []
    if found["categories"]:
        notes.append(
            f"{', '.join(found['categories'])}: few values or one-word codes, so categories."
        )
    if found["empty"]:
        notes.append(f"{', '.join(found['empty'])} has no values in the train rows.")
    if found["columns"]:
        reason = (
            f"{', '.join(found['columns'])}: many values, most of several words, so free text. "
            "Its words and their weights are learnt from the train rows."
        )
        return ctx.choose("vectorize_words", " ".join([reason, *notes]))
    return ctx.choose("no_free_text", " ".join(["No free text reaches the model.", *notes]))
