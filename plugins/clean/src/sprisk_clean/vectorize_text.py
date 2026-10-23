from collections.abc import Sequence
from typing import Any

import polars as pl
from scipy import sparse
from sklearn.feature_extraction.text import TfidfVectorizer


def vectorize_text(
    train: pl.DataFrame,
    test: pl.DataFrame,
    columns: list[str],
    ngram_range: Sequence[int] = (1, 1),
    min_df: int = 1,
) -> dict[str, Any]:
    """Word features of free text (ADR-0058): one TF-IDF vectorizer per column, its words and
    their weights learnt from the train rows only. A word seen only in test rows is ignored, and
    so is one in fewer than `min_df` train rows.
    Missing text is read as empty and gives a row of zeros. Each word is named after its
    column (`title:red`), so two columns never share a name. The tables lose the text columns.
    Each matrix is the pair the worker stores: the SciPy matrix and its column names."""
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
    return {
        "train": train.drop(columns),
        "test": test.drop(columns),
        "train_words": (sparse.hstack(learnt).tocsr(), names),
        "test_words": (sparse.hstack(applied).tocsr(), names),
    }


def as_code(settings: dict[str, Any], inputs: dict[str, str], outputs: dict[str, str]) -> str:
    """This step as plain Python for a notebook cell (ADR-0055); a test runs it against the
    step. Helper names start with the train output's name, so they never replace a person's."""
    train, test = inputs["train"], inputs["test"]
    columns = settings["columns"]
    low, high = settings.get("ngram_range", [1, 1])
    min_df = settings.get("min_df", 1)
    vectorizers = f"{outputs['train']}_vectorizers"
    return (
        "from scipy import sparse\n"
        "from sklearn.feature_extraction.text import TfidfVectorizer\n"
        "\n"
        "# One vectorizer per text column, learnt from the training rows only.\n"
        f"{vectorizers} = {{\n"
        f"    c: TfidfVectorizer(ngram_range=({low!r}, {high!r}), min_df={min_df!r})\n"
        f"    for c in {columns!r}\n"
        "}\n"
        "# Missing text is read as empty: a row of zeros.\n"
        f"{outputs['train_words']} = sparse.hstack([\n"
        f'    v.fit_transform({train}[c].fill_null("").to_list())\n'
        f"    for c, v in {vectorizers}.items()\n"
        "]).tocsr()\n"
        f"{outputs['test_words']} = sparse.hstack([\n"
        f'    v.transform({test}[c].fill_null("").to_list()) for c, v in {vectorizers}.items()\n'
        "]).tocsr()\n"
        f"{outputs['train']} = {train}.drop({columns!r})\n"
        f"{outputs['test']} = {test}.drop({columns!r})\n"
    )
