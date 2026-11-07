from typing import Any


def decide(ctx: Any) -> Any:
    if ctx.bound("common.item_identity"):
        return ctx.choose(
            "maker_groups",
            "The question names who made each recording, so the split keeps each maker's "
            "recordings on one side and no maker's sound is scored on clips the model heard.",
        )
    # Clips by one artist or speaker share a sound (room, voice, mastering). A random split puts
    # that sound on both sides and the score rises without the model learning the task, so a
    # person states the maker before the split is chosen.
    return ctx.ask(
        "maker_groups",
        "Recordings by one artist, uploader or speaker share a sound, and a random split lets "
        "the model score on a sound it heard. State the question's entity column, the one that "
        "says who made each recording, or answer that every recording has its own maker.",
    )
