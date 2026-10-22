import polars as pl

OTHER = "other"


def group_rare(
    train: pl.DataFrame,
    test: pl.DataFrame,
    columns: list[str],
    min_share: float = 0.01,
    max_categories: int | None = None,
) -> dict[str, pl.DataFrame]:
    """Categories under `min_share` of the train rows become "other", as scikit-learn's
    OneHotEncoder(min_frequency, max_categories) groups them. When more are left than
    `max_categories`, only the most frequent stay, so the column has at most
    `max_categories` values counting "other". Test rows keep only the categories kept on
    train, so one seen only in test also becomes "other". A gap stays a gap."""
    grouped = []
    for c in columns:
        if train.schema[c] not in (pl.String, pl.Categorical, pl.Enum):
            raise ValueError(f"{c} is not text; only categories are grouped")
        counts = (
            train[c]
            .cast(pl.String)
            .drop_nulls()
            .value_counts()
            .filter(pl.col("count") >= min_share * train.height)
            # Ties go by name, so the same rows always keep the same categories.
            .sort(["count", c], descending=[True, False])
        )
        kept = counts[c].to_list()
        if max_categories is not None and len(kept) > max_categories:
            kept = kept[: max_categories - 1]
        text = pl.col(c).cast(pl.String)
        grouped.append(
            pl.when(text.is_null() | text.is_in(kept)).then(text).otherwise(pl.lit(OTHER)).alias(c)
        )
    return {"train": train.with_columns(grouped), "test": test.with_columns(grouped)}
