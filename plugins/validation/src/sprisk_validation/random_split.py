import plotly.graph_objects as go
import polars as pl

from sprisk_workers.authoring import Verdict, operator, promise


@promise(
    id="no_row_in_both",
    text="No test row has the same features as a train row.",
    evidence="evaluation.row_overlap",
    fields={"in_both": int, "train_rows": int, "test_rows": int},
    columns={"target": "common.target"},
    title="Row leakage check",
)
def no_row_in_both(train: pl.DataFrame, test: pl.DataFrame, target: str) -> Verdict:
    """Counts the test rows whose features match a train row, the evidence that a random
    split leaves no row on both sides. The target is dropped first, so no test label is read
    (ADR-0064).

    Args:
        target: The column the model predicts, dropped before the rows are compared.
    """
    # The worker drops the target before this runs, so no test label is read; a table that
    # still has it is compared without it.
    features = [c for c in test.columns if c != target]
    if not features:
        raise ValueError(f"the test rows have no feature columns beside {target} to compare")
    learned = train.select(features).unique()
    both = test.select(features).join(learned, on=features, how="semi", nulls_equal=True)
    evidence = {"in_both": both.height, "train_rows": train.height, "test_rows": test.height}
    if both.height:
        return Verdict(
            "fail",
            f"{both.height} test rows have the same features as a train row: the model is "
            "scored on rows it learned. Treat repeated rows as one item.",
            evidence,
        )
    return Verdict("pass", f"No test row repeats a train row ({test.height} test rows).", evidence)


@operator(
    id="random_split",
    inputs=["data"],
    outputs=["train", "test"],
    role="split",
    folds="plain",
    role_default=True,
    tunables={
        "test_fraction": {"minimum": 0.05, "maximum": 0.5, "step": 0.05},
        "seed": {"minimum": 0},
    },
    promises=[no_row_in_both],
)
def random_split(
    data: pl.DataFrame, test_fraction: float = 0.2, seed: int = 42
) -> tuple[pl.DataFrame, pl.DataFrame]:
    """Holds out a random fifth of rows for test, with a fixed seed.

    Args:
        test_fraction: Share of rows held out for testing.
        seed: Fixes the shuffle so runs repeat.
    """
    shuffled = data.sample(fraction=1.0, shuffle=True, seed=seed)
    n_test = round(shuffled.height * test_fraction)
    train, test = shuffled.slice(n_test), shuffled.head(n_test)
    if train.is_empty() or test.is_empty():
        raise ValueError(f"split gave {train.height} train and {test.height} test rows")
    return train, test


def rows_per_side(train: pl.DataFrame, test: pl.DataFrame) -> go.Figure:
    """Rows on each side"""
    figure = go.Figure(go.Bar(x=["train", "test"], y=[train.height, test.height]))
    return figure.update_layout(yaxis_title="rows")
