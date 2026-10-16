import polars as pl


def clean_text(
    data: pl.DataFrame, columns: list[str], lowercase: bool = False, empty_to_null: bool = True
) -> pl.DataFrame:
    """Trim, collapse repeated spaces, optionally lowercase; blank text becomes missing."""
    cleaned = []
    for c in columns:
        dtype = data.schema.get(c)
        if dtype is None:
            raise pl.exceptions.ColumnNotFoundError(c)
        if dtype != pl.String:
            raise ValueError(f"{c} is not a text column ({dtype})")
        col = pl.col(c).str.strip_chars().str.replace_all(r"\s+", " ")
        if lowercase:
            col = col.str.to_lowercase()
        if empty_to_null:
            col = pl.when(col == "").then(None).otherwise(col)
        cleaned.append(col.alias(c))
    return data.with_columns(cleaned)
