import polars as pl


def scale(
    train: pl.DataFrame, test: pl.DataFrame, columns: list[str], method: str
) -> dict[str, pl.DataFrame]:
    """Min-max, z-score or robust (median and IQR) with train statistics; test may fall outside [0, 1].

    NaN counts as missing, so it never sets the range."""
    nan_to_null = [pl.col(c).fill_nan(None) for c in columns if train.schema[c].is_float()]
    train, test = train.with_columns(nan_to_null), test.with_columns(nan_to_null)

    scaled = []
    for c in columns:
        low, high, mean, std, median, q25, q75 = train.select(
            low=pl.col(c).min(),
            high=pl.col(c).max(),
            mean=pl.col(c).mean(),
            std=pl.col(c).std(ddof=0),
            median=pl.col(c).median(),
            q25=pl.col(c).quantile(0.25, interpolation="linear"),
            q75=pl.col(c).quantile(0.75, interpolation="linear"),
        ).row(0)
        if method == "min_max":
            centre, spread = low, (None if low is None else high - low)
        elif method == "robust":
            centre, spread = median, (None if median is None else q75 - q25)
        else:
            centre, spread = mean, std
        if centre is None or not spread:
            raise ValueError(f"column {c} has no spread in train")
        scaled.append(((pl.col(c) - centre) / spread).alias(c))
    return {"train": train.with_columns(scaled), "test": test.with_columns(scaled)}
