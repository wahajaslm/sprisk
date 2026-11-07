from typing import Any

# Copy share above which a person says whether copies are meant. As for exact duplicates: a few
# copies are listing errors; many may be one recording labelled several ways on purpose.
ASK_ABOVE_SHARE = 0.05


def decide(ctx: Any) -> Any:
    found = ctx.evidence("audio.recording_copies")
    if found is None:
        return ctx.choose("keep", "Repeated recordings were not measured, so every row stays.")
    rows, copies = found["rows"], found["copies"]
    if not copies:
        return ctx.choose("keep", "No recording is listed twice.")
    share = copies / rows
    if share > ASK_ABOVE_SHARE:
        return ctx.ask(
            "keep",
            f"{copies} of {rows} rows ({share:.0%}) repeat an earlier recording, more than "
            f"{ASK_ABOVE_SHARE:.0%}. One recording may carry several labels on purpose; say "
            "whether they are copies.",
        )
    return ctx.choose(
        "drop",
        f"{copies} of {rows} rows repeat an earlier recording. The first row of each is kept "
        "before the split, so no recording is scored on audio the model heard.",
    )
