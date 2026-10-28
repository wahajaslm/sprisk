from sprisk_validation import group_split, random_split, stratified_split, temporal_split
from sprisk_workers.authoring import method, option


@method(
    id="split_method",
    decides="split.method",
    activity="Fair evaluation",
    applies_when={"task": ["classification", "regression"]},
    decisions=["data.repeated_items"],
    columns={
        "target": "common.target",
        "event_time": "common.event_time",
        "item_identity": "common.item_identity",
    },
    options={
        "temporal": option(
            "Train on earlier rows, test on later ones",
            temporal_split,
            when="a time column is named",
            condition="time column named",
        ),
        "item_groups": option(
            "Keep each item's rows on one side",
            group_split,
            when="an item column is named, and no time column",
            condition="item column ∧ ¬ time column",
        ),
        "stratified_random": option(
            "Random rows, with class shares kept",
            stratified_split,
            when="a class target, with no time or item column",
            condition="class target ∧ ¬ time ∧ ¬ item",
            # Rows repeated across a random split have one fix: keep each item on one side.
            fallbacks=["item_groups"],
        ),
        "simple_random": option(
            "Random rows",
            random_split,
            when="no time or item column, and no class target",
            condition="¬ time ∧ ¬ item ∧ ¬ class target",
            fallbacks=["item_groups"],
        ),
    },
    source=(
        "Roberts et al. (2017), Ecography 40(8): cross-validation for temporal and grouped "
        "data; scikit-learn User Guide §3.1: GroupShuffleSplit, train_test_split(stratify=y)."
    ),
)
def split(task, target, event_time, item_identity):  # type: ignore[no-untyped-def]
    """Train/test split

    How are rows divided into training and test so the score is fair?

    Shuffling rows across time or across repeated items puts the future or the same item in
    both train and test. The score then looks better than the model will do on new data.
    """
    # A time or item split that breaks its promise has no fair stand-in: a random split
    # would put the future, or the same item, on both sides. So they list no fallbacks.
    if event_time:
        return method.choose(
            "temporal",
            reason="A time column orders the rows: train on earlier rows, test on later ones. "
            "The split leaves no gap at the cutoff, so a label that looks ahead may share its "
            "window with the first test rows.",
        )
    if item_identity:
        return method.choose(
            "item_groups",
            reason="Rows of one item stay on one side, so no item is scored on rows the model saw.",
        )
    if task == "classification" and target:
        return method.choose(
            "stratified_random",
            reason="Every row is its own item, and each class keeps its share in train and test.",
        )
    return method.choose("simple_random", reason="Every row is its own item.")
