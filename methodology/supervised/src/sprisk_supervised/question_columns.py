"""Which column the question names for a concept: a binding a person stated or confirmed, else
the question's own fact for it, when that fact may decide (ADR-0063)."""

from sprisk_contracts import QuestionVersion
from sprisk_contracts.generated.models import Fact

# The concepts a question's time and entity facts stand for (ADR-0063 amendment).
EVENT_TIME = "common.event_time"
ITEM_IDENTITY = "common.item_identity"


def authoritative(fact: Fact | None) -> str | None:
    """A fact's value when it may decide: an inferred fact only asks, never decides."""
    if fact is None or fact.origin.value == "inferred":
        return None
    return fact.value


def bound_column(question: QuestionVersion, concept: str, fact: Fact | None) -> str | None:
    """The column the question binds `concept` to, else its fact for it when authoritative. A
    binding a person stated or confirmed takes the place of a fact, as in the walk; one a
    method set unasked does not."""
    for binding in question.bindings or []:
        if binding.concept.root == concept and binding.set_by.root.assurance != "rule":
            return binding.source.column
    return authoritative(fact)
