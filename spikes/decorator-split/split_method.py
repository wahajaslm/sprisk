from concepts import EventTime, ItemIdentity, Target, Task
from sprisk import Choice, choose, method
from validation import group_split, random_split, stratified_split, temporal_split


@method(
    decides="split.method",
    name="Train/test split",
    activity="Fair evaluation",
    question="How are rows divided into training and test so the score is fair?",
    applies_when={"task": ["classification", "regression"]},
    decisions=["data.repeated_items"],
    options={
        "temporal": temporal_split,
        "item_groups": group_split,
        "stratified_random": stratified_split,
        "simple_random": random_split,
    },
    source=(
        "Roberts et al. (2017), Ecography 40(8): cross-validation for temporal and grouped "
        "data; scikit-learn User Guide §3.1: GroupShuffleSplit, train_test_split(stratify=y)."
    ),
)
def split_method(
    task: Task,
    event_time: EventTime | None,
    item_identity: ItemIdentity | None,
    target: Target | None,
) -> Choice:
    if event_time:
        return choose(
            "temporal",
            "A time column orders the rows: train on earlier rows, test on later ones. The split "
            "leaves no gap at the cutoff, so a label that looks ahead may share its window "
            "with the first test rows.",
        )
    if item_identity:
        return choose(
            "item_groups",
            "Rows of one item stay on one side, so no item is scored on rows the model saw.",
        )
    if task == "classification" and target:
        return choose(
            "stratified_random",
            "Every row is its own item, and each class keeps its share in train and test.",
        )
    return choose("simple_random", "Every row is its own item.")
