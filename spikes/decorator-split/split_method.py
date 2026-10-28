from sprisk import method
from validation import group_split, random_split, stratified_split, temporal_split


@method(
    id="split_method",
    decides="split.method",
    name="Train/test split",
    activity="Fair evaluation",
    question="How are rows divided into training and test so the score is fair?",
    applies_when={"task": ["classification", "regression"]},
    decisions=["data.repeated_items"],
    columns={
        "event_time": "common.event_time",
        "item_identity": "common.item_identity",
        "target": "common.target",
    },
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
def split(task, event_time, item_identity, target):
    if event_time:
        return method.choose("temporal", reason="Train on earlier rows, test on later ones.")
    if item_identity:
        return method.choose("item_groups", reason="Rows of one item stay on one side.")
    if task == "classification" and target:
        return method.choose(
            "stratified_random", reason="Each class keeps its share in train and test."
        )
    return method.choose("simple_random", reason="Every row is its own item.")
