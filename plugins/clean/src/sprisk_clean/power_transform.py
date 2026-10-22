import polars as pl
from sklearn.preprocessing import PowerTransformer


def power_transform(
    train: pl.DataFrame, test: pl.DataFrame, columns: list[str]
) -> dict[str, pl.DataFrame]:
    """Yeo-Johnson with scikit-learn's PowerTransformer, fit on the train rows and applied to
    both, so a skewed column comes out close to symmetric with mean 0 and spread 1.

    NaN counts as missing: it never sets the transform and stays a gap."""
    for c in columns:
        if not train.schema[c].is_numeric():
            raise ValueError(f"{c} is not a number; only numbers are transformed")
    as_float = [pl.col(c).cast(pl.Float64).fill_nan(None) for c in columns]
    train, test = train.with_columns(as_float), test.with_columns(as_float)
    for c in columns:
        if train[c].drop_nulls().n_unique() < 2:
            raise ValueError(f"column {c} has no spread in train")

    # scikit-learn ignores NaN when fitting and keeps it when transforming.
    fitted = PowerTransformer(method="yeo-johnson").fit(train.select(columns).to_numpy())

    def transformed(rows: pl.DataFrame) -> pl.DataFrame:
        values = fitted.transform(rows.select(columns).to_numpy())
        return rows.with_columns(
            pl.Series(c, values[:, i]).fill_nan(None) for i, c in enumerate(columns)
        )

    return {"train": transformed(train), "test": transformed(test)}
