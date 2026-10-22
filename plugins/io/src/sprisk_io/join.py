import polars as pl


def join(data: pl.DataFrame, other: pl.DataFrame, key: str) -> pl.DataFrame:
    """Each row of `data` takes the columns of the `other` row with its `key`, in its own order;
    a row whose key finds none keeps gaps. Fits nothing, so it runs before the split. A key
    `other` repeats is refused: it would copy rows and change the unit of prediction."""
    for table, side in ((data, "the rows"), (other, "the other table")):
        if key not in table.columns:
            raise ValueError(f"{side} have no key column {key}")
    if data.schema[key] != other.schema[key]:
        raise ValueError(
            f"{key} is {data.schema[key]} in the rows but {other.schema[key]} in the other "
            "table: values of another type never match"
        )
    shared = sorted(set(data.columns) & set(other.columns) - {key})
    if shared:
        raise ValueError(f"both tables have {', '.join(shared)}: it is unclear which to keep")
    try:
        return data.join(other, on=key, how="left", validate="m:1", maintain_order="left")
    except pl.exceptions.ComputeError as e:
        raise ValueError(f"the other table has more than one row for some {key}: {e}") from e
