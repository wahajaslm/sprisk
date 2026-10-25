from typing import Any

from sprisk_workers.errors import MethodError


def decide(ctx: Any) -> Any:
    # The task is stated before the walk (ADR-0063 amendment); its promise checks the labels.
    failed = ctx.ruled_out(ctx.task)
    if failed is not None:
        # The task is the question's, so only a new question revision changes it.
        raise MethodError(
            f"The question says {ctx.task}, but the target broke its promise: {failed} "
            "Walk again once you restate the question's task."
        )
    return ctx.choose(ctx.task, f"The question says {ctx.task}.")


def verify_labels_are_classes(
    evidence: dict[str, Any], settings: dict[str, Any]
) -> tuple[str, str]:
    distinct = evidence["distinct"]
    if distinct < 2:
        return "fail", f"The target has {distinct} label on the train rows: nothing to predict."
    if evidence["numeric"] and not evidence["whole_numbers"]:
        return "fail", (
            f"The target holds decimal values ({distinct} distinct on the train rows): a "
            "quantity, not classes."
        )
    return "pass", f"The target has {distinct} labels on the train rows."


def verify_labels_are_numbers(
    evidence: dict[str, Any], settings: dict[str, Any]
) -> tuple[str, str]:
    if not evidence["numeric"]:
        return "fail", "The target holds text, which a model cannot predict as a number."
    return "pass", f"The target holds numbers ({evidence['distinct']} distinct on the train rows)."
