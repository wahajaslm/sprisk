import polars as pl


def scale(
    train: pl.DataFrame, test: pl.DataFrame, columns: list[str], method: str
) -> dict[str, pl.DataFrame]:
    """Min-max or z-score with the train range or moments; test may fall outside [0, 1].

    NaN counts as missing, so it never sets the range."""
    nan_to_null = [pl.col(c).fill_nan(None) for c in columns if train.schema[c].is_float()]
    train, test = train.with_columns(nan_to_null), test.with_columns(nan_to_null)

    scaled = []
    for c in columns:
        low, high, mean, std = train.select(
            low=pl.col(c).min(),
            high=pl.col(c).max(),
            mean=pl.col(c).mean(),
            std=pl.col(c).std(ddof=0),
        ).row(0)
        if method == "min_max":
            centre, spread = low, (None if low is None else high - low)
        else:
            centre, spread = mean, std
        if centre is None or not spread:
            raise ValueError(f"column {c} has no spread in train")
        scaled.append(((pl.col(c) - centre) / spread).alias(c))
    return {"train": train.with_columns(scaled), "test": test.with_columns(scaled)}
