import polars as pl


def select_columns(data: pl.DataFrame, columns: list[str]) -> pl.DataFrame:
    """Keep only these columns, in this order."""
    return data.select(columns)


def drop_columns(data: pl.DataFrame, columns: list[str]) -> pl.DataFrame:
    """Leave out these columns; every other column stays, including one a step added."""
    return data.drop(columns, strict=True)


def leave_out(
    train: pl.DataFrame, test: pl.DataFrame, columns: list[str]
) -> dict[str, pl.DataFrame]:
    """Leave these columns out of train and test alike, before a model."""
    return {"train": train.drop(columns, strict=True), "test": test.drop(columns, strict=True)}


def drop_missing(data: pl.DataFrame, columns: list[str]) -> pl.DataFrame:
    """Drop rows with a missing value (null or NaN) in any of these columns."""
    nan_to_null = [pl.col(c).fill_nan(None) for c in columns if data.schema[c].is_float()]
    return data.with_columns(nan_to_null).drop_nulls(columns)


# Digits a float64 holds exactly (IEEE 754 double: 15 significant decimal digits).
MAX_DIGITS = 15


def drop_duplicates(data: pl.DataFrame, columns: list[str] | None = None) -> pl.DataFrame:
    """Keep the first of each set of rows equal in these columns (all when none are named),
    in the original order. Run before the split, so no row is in both train and test."""
    return data.unique(subset=columns, keep="first", maintain_order=True)


def mark_missing(data: pl.DataFrame, columns: list[str], values: list[str]) -> pl.DataFrame:
    """Text that stands for a gap, such as "?" or "n/a", becomes missing in these columns.
    Whole values only, so "n/a yet" stays."""
    for c in columns:
        if data.schema[c] != pl.String:
            raise ValueError(f"{c} is not text; only text columns hold gap markers")
    return data.with_columns(
        pl.when(pl.col(c).is_in(values)).then(None).otherwise(pl.col(c)).alias(c) for c in columns
    )


def cast_types(data: pl.DataFrame, columns: list[str]) -> pl.DataFrame:
    """Text columns that hold numbers become numbers: whole ones Int64, others Float64. Spaces
    around a value are ignored. Run before the split; it fits nothing. Fails on any present
    value that does not read as a finite number, naming it, so a placeholder left in the column
    is never turned into a gap without a person seeing it, and on any value with more than 15
    digits, which a float cannot hold exactly (account numbers, long IDs).
    Columns are taken as series, never by `pl.col(name)`: a dataset's column name (untrusted,
    rule 7) like `^.*$` would be read as a pattern there."""
    cast = []
    for c in columns:
        text = data[c]
        if text.dtype != pl.String:
            raise ValueError(f"{c} is not text; only text columns are cast")
        trimmed = text.str.strip_chars()
        long = trimmed.str.count_matches(r"\d") > MAX_DIGITS
        if long.any():
            raise ValueError(f"{c}: {text.filter(long)[0]!r} has more than {MAX_DIGITS} digits")
        numbers = trimmed.cast(pl.Float64, strict=False)
        bad = text.is_not_null() & (numbers.is_null() | ~numbers.is_finite())
        if bad.any():
            raise ValueError(f"{c}: {text.filter(bad)[0]!r} does not read as a number")
        whole = trimmed.drop_nulls().str.contains(r"^[+-]?\d+$").all()
        cast.append(trimmed.cast(pl.Int64) if whole else numbers)
    return data.with_columns(cast)
