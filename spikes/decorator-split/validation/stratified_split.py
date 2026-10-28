import plotly.graph_objects as go
import polars as pl
from sklearn.model_selection import train_test_split

from sprisk import Verdict, operator, promise


@promise(id="no_row_in_both", text="No test row has the same features as a train row.")
def no_row_in_both(train: pl.DataFrame, test: pl.DataFrame):
    repeated = test.join(train.unique(), on=test.columns, how="semi", nulls_equal=True).height
    evidence = {"repeated_rows": repeated, "test_rows": test.height}
    if repeated:
        return Verdict("fail", f"{repeated} test rows repeat a train row.", evidence)
    return Verdict("pass", "No test row repeats a train row.", evidence)


def class_shares(train: pl.DataFrame, test: pl.DataFrame, stratify: str) -> go.Figure:
    """Class shares in train and test"""
    figure = go.Figure()
    for name, side in (("train", train), ("test", test)):
        shares = side[stratify].value_counts(normalize=True).sort(stratify)
        figure.add_bar(x=shares[stratify], y=shares["proportion"], name=name)
    return figure


@operator(
    id="stratified_split",
    inputs=["data"],
    outputs=["train", "test"],
    role="split",
    folds="plain",
    columns={"stratify": "common.target"},
    tunables={
        "test_fraction": {"minimum": 0.05, "maximum": 0.40, "step": 0.05},
        "seed": {"minimum": 0, "maximum": 10000},
    },
    promises=[no_row_in_both],
)
def stratified_split(
    data: pl.DataFrame, stratify: str, test_fraction: float = 0.20, seed: int = 42
):
    """Shuffle rows into train and test, keeping each class's share on both sides."""
    if data[stratify].null_count():
        raise ValueError(f"{stratify} has {data[stratify].null_count()} missing values")
    train_rows, test_rows = train_test_split(
        list(range(data.height)),
        test_size=test_fraction,
        random_state=seed,
        stratify=data[stratify].to_list(),
    )
    return data[sorted(train_rows)], data[sorted(test_rows)]
