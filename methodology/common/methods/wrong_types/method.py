from typing import Any


def decide(ctx: Any) -> Any:
    found = ctx.evidence("data.number_text")
    if found is None:
        return ctx.choose("keep", "Numbers in text were not measured, so types stay as read.")
    marked = ctx.decision("data.missing_markers") == "mark"
    notes = []
    unmarked = [c for c in found["numbers_once_marked"] if c not in found["numbers"]]
    if unmarked and not marked:
        notes.append(f"{', '.join(unmarked)}: placeholders were not marked, so it stays text.")
    if found["codes"]:
        notes.append(f"{', '.join(found['codes'])}: numbers with leading zeros, like codes.")
    if found["comma_numbers"]:
        notes.append(
            f"{'; '.join(found['comma_numbers'])}: a comma may separate thousands or "
            "decimals, so it stays text."
        )
    columns = found["numbers_once_marked"] if marked else found["numbers"]
    if columns:
        reason = f"{', '.join(columns)}: every value reads as a number, but the column is text."
        option = "cast_marked" if marked and unmarked else "cast"
        return ctx.choose(option, " ".join([reason, *notes]))
    return ctx.choose("keep", " ".join(["No text column is numbers stored as text.", *notes]))
