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
        # A series, never pl.col(c): a column name (untrusted, rule 7) may look like a pattern.
        text = data[c].str.strip_chars().str.replace_all(r"\s+", " ")
        if lowercase:
            text = text.str.to_lowercase()
        if empty_to_null:
            text = text.set(text == "", None)
        cleaned.append(text)
    return data.with_columns(cleaned)
