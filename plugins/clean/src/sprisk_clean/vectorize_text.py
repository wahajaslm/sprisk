from collections.abc import Sequence
from typing import Annotated, Any

import polars as pl
from scipy import sparse
from sklearn.feature_extraction.text import TfidfVectorizer

from sprisk_workers.authoring import Columns, operator


@operator(
    id="vectorize_text",
    version="1.1.0",
    title="TF-IDF vectorization",
    stage="clean",
    inputs=["train", "test"],
    outputs={
        "train": {"kind": "table", "description": "The train rows without the text columns."},
        "test": {"kind": "table", "description": "The test rows without the text columns."},
        "train_words": {
            "kind": "matrix",
            "description": "Word features of the train rows, row for row.",
        },
        "test_words": {
            "kind": "matrix",
            "description": "Word features of the test rows, with the train rows' words only.",
        },
    },
    fits_on_train=True,
    resources={"cpu_cores": 1, "memory_mb": 4096, "gpu": "none", "timeout_seconds": 1800},
)
def vectorize_text(
    train: pl.DataFrame,
    test: pl.DataFrame,
    columns: Columns,
    ngram_range: Annotated[
        Sequence[int],
        {"items": {"type": "integer", "minimum": 1, "maximum": 3}, "minItems": 2, "maxItems": 2},
    ] = (1, 1),
    min_df: Annotated[int, {"minimum": 1}] = 1,
) -> tuple[pl.DataFrame, pl.DataFrame, Any, Any]:
    """Free text becomes word features, TF-IDF weighted, learnt from the train rows only
    (ADR-0058). Each text column leaves the tables and becomes words in a sparse matrix, named
    after its column. A word seen only in test rows, or in fewer train rows than min_df, is
    ignored; missing text gives a row of zeros.

    Args:
        columns: Text columns to turn into words.
        ngram_range: Shortest and longest run of words that is a feature: [1, 1] single words,
            [1, 2] words and word pairs.
        min_df: Fewest train rows a word must appear in to be a feature. 2 leaves out words of
            one row, which shrinks the vocabulary. A whole number: 1.0 is refused.
    """

    for rows, which in ((train, "train"), (test, "test")):
        for c in columns:
            if c not in rows.columns:
                raise ValueError(f"{c} is not a column of the {which} rows")
            if rows.schema[c] != pl.String:
                raise ValueError(f"{c} is not text in the {which} rows; only text becomes words")
    # JSON Schema takes 1.0 for an integer, and scikit-learn reads a float as a share of rows.
    if type(min_df) is not int:
        raise ValueError(f"min_df must be a whole count of rows, not {min_df!r}")
    if min_df > train.height:
        raise ValueError(f"min_df {min_df} is above the {train.height} train rows")
    vectorizers = {
        c: TfidfVectorizer(ngram_range=(ngram_range[0], ngram_range[1]), min_df=min_df)
        for c in columns
    }
    learnt = []
    for c, v in vectorizers.items():
        try:
            learnt.append(v.fit_transform(train[c].fill_null("").to_list()))
        except ValueError as e:
            if "empty vocabulary" in str(e):
                raise ValueError(f"{c} has no words in the train rows") from e
            if "no terms remain" in str(e):
                raise ValueError(f"{c} has no word in at least {min_df} train rows") from e
            raise
    applied = [v.transform(test[c].fill_null("").to_list()) for c, v in vectorizers.items()]
    names = tuple(f"{c}:{w}" for c, v in vectorizers.items() for w in v.get_feature_names_out())
    # Each matrix is the pair the worker stores: the SciPy matrix and its column names.
    return (
        train.drop(columns),
        test.drop(columns),
        (sparse.hstack(learnt).tocsr(), names),
        (sparse.hstack(applied).tocsr(), names),
    )
