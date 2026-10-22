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
) -> dict[str, Any]:
    """Word features of free text (ADR-0058): one TF-IDF vectorizer per column, its words and
    their weights learnt from the train rows only. A word seen only in test rows is ignored.
    Missing text is read as empty and gives a row of zeros. Each word is named after its
    column (`title:red`), so two columns never share a name. The tables lose the text columns.
    Each matrix is the pair the worker stores: the SciPy matrix and its column names."""
    for rows, which in ((train, "train"), (test, "test")):
        for c in columns:
            if c not in rows.columns:
                raise ValueError(f"{c} is not a column of the {which} rows")
            if rows.schema[c] != pl.String:
                raise ValueError(f"{c} is not text in the {which} rows; only text becomes words")
    vectorizers = {
        c: TfidfVectorizer(ngram_range=(ngram_range[0], ngram_range[1])) for c in columns
    }
    learnt = []
    for c, v in vectorizers.items():
        try:
            learnt.append(v.fit_transform(train[c].fill_null("").to_list()))
        except ValueError as e:
            if "empty vocabulary" not in str(e):
                raise
            raise ValueError(f"{c} has no words in the train rows") from e
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
    vectorizers = f"{outputs['train']}_vectorizers"
    return (
        "from scipy import sparse\n"
        "from sklearn.feature_extraction.text import TfidfVectorizer\n"
        "\n"
        "# One vectorizer per text column, learnt from the training rows only.\n"
        f"{vectorizers} = {{\n"
        f"    c: TfidfVectorizer(ngram_range=({low!r}, {high!r})) for c in {columns!r}\n"
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
