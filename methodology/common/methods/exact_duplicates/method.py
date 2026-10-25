from typing import Any

# Copy share above which a person says whether rows are copies. A project convention: a few
# copies are load errors; many may be real repeated observations, and dropping them changes
# class shares.
ASK_ABOVE_SHARE = 0.05


def decide(ctx: Any) -> Any:
    found = ctx.evidence("data.duplicate_rows")
    if found is None:
        return ctx.choose("keep", "Copies were not measured, so every row stays.")
    rows, copies = found["rows"], found["duplicates"]
    if not copies:
        return ctx.choose("keep", "No row repeats an earlier one.")
    share = copies / rows
    if share > ASK_ABOVE_SHARE:
        return ctx.ask(
            "keep",
            f"{copies} of {rows} rows ({share:.0%}) repeat an earlier row, more than "
            f"{ASK_ABOVE_SHARE:.0%}. They may be real repeated observations; say whether they "
            "are copies.",
        )
    return ctx.choose(
        "drop",
        f"{copies} of {rows} rows repeat an earlier row in every feature. Those that also share "
        "its target are dropped before the split, so a copy cannot land in both train and test.",
    )
