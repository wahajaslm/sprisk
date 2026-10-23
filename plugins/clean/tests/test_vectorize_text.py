from pathlib import Path
from typing import Any

import polars as pl
import pytest

from sprisk_clean.vectorize_text import as_code, vectorize_text
from sprisk_workers.manifests import load_operators
from sprisk_workers.matrix import Matrix, read_matrix
from sprisk_workers.output import MATRIX

TRAIN = pl.DataFrame(
    {
        "title": ["red shoe", "blue shoe", "red hat", None],
        "body": ["soft leather", "", "warm wool", "soft wool"],
        "price": [10, 20, 30, 40],
    }
)
TEST = pl.DataFrame({"title": ["red zebra", "zebra"], "body": ["wool", None], "price": [5, 6]})


def words(out: dict[str, Any], port: str) -> Matrix:
    values, names = out[port]
    return Matrix(values, names)


def test_the_text_columns_become_words_named_after_their_column() -> None:
    out = vectorize_text(TRAIN, TEST, columns=["title", "body"])

    assert out["train"].columns == ["price"]
    assert out["test"].columns == ["price"]
    assert words(out, "train_words").columns == (
        "title:blue", "title:hat", "title:red", "title:shoe",
        "body:leather", "body:soft", "body:warm", "body:wool",
    )  # fmt: skip
    assert words(out, "train_words").values.shape == (4, 8)
    assert words(out, "test_words").values.shape == (2, 8)


def test_the_vocabulary_is_learnt_from_train_rows_only() -> None:
    out = vectorize_text(TRAIN, TEST, columns=["title"])
    test = words(out, "test_words")

    assert "title:zebra" not in test.columns
    # "red zebra" keeps only "red"; "zebra" alone has no word the train rows know.
    dense = test.values.toarray()
    assert dense[0, test.columns.index("title:red")] == pytest.approx(1.0)
    assert dense[1].sum() == 0


def test_missing_and_empty_text_give_a_row_of_zeros() -> None:
    out = vectorize_text(TRAIN, TEST, columns=["title", "body"])

    train = words(out, "train_words").values.toarray()
    assert train[3, :4].sum() == 0  # title missing
    assert train[1, 4:].sum() == 0  # body empty
    assert words(out, "test_words").values.toarray()[1, 4:].sum() == 0  # body missing


def test_word_pairs_are_words_too_when_asked_for() -> None:
    out = vectorize_text(TRAIN, TEST, columns=["title"], ngram_range=[1, 2])
    assert "title:red shoe" in words(out, "train_words").columns


def test_only_text_columns_can_be_vectorized() -> None:
    with pytest.raises(ValueError, match="price is not text"):
        vectorize_text(TRAIN, TEST, columns=["price"])


def test_the_word_weights_are_learnt_from_train_rows_only() -> None:
    # Test rows full of "red" would lower its IDF weight if they were learnt from.
    reds = pl.DataFrame({"title": ["red"] * 50, "body": [""] * 50, "price": [0] * 50})
    alone = words(vectorize_text(TRAIN, TEST, columns=["title"]), "train_words")
    beside = words(vectorize_text(TRAIN, reds, columns=["title"]), "train_words")
    assert (alone.values != beside.values).nnz == 0


def test_the_test_rows_columns_must_be_text_too() -> None:
    numbers = TEST.with_columns(pl.col("price").alias("title"))
    with pytest.raises(ValueError, match="title is not text in the test rows"):
        vectorize_text(TRAIN, numbers, columns=["title"])


def test_a_column_missing_from_a_table_is_named() -> None:
    with pytest.raises(ValueError, match="colour is not a column of the train rows"):
        vectorize_text(TRAIN, TEST, columns=["colour"])


def test_a_column_with_no_words_in_train_is_named() -> None:
    blank = TRAIN.with_columns(pl.lit(None, pl.String).alias("body"))
    with pytest.raises(ValueError, match="body has no words in the train rows"):
        vectorize_text(blank, TEST, columns=["title", "body"])


def test_the_shortest_word_run_cannot_exceed_the_longest() -> None:
    with pytest.raises(ValueError, match="ngram_range"):
        vectorize_text(TRAIN, TEST, columns=["title"], ngram_range=[2, 1])


def test_plain_code_gives_the_same_tables_and_words() -> None:
    settings = {"columns": ["title", "body"], "ngram_range": [1, 2]}
    namespace: dict[str, object] = {"rows": TRAIN, "held_out": TEST}
    exec(
        as_code(
            settings,
            {"train": "rows", "test": "held_out"},
            {"train": "a", "test": "b", "train_words": "a_words", "test_words": "b_words"},
        ),
        namespace,
    )
    step = vectorize_text(TRAIN, TEST, columns=["title", "body"], ngram_range=[1, 2])
    assert namespace["a"].equals(step["train"])  # type: ignore[attr-defined]
    assert namespace["b"].equals(step["test"])  # type: ignore[attr-defined]
    for name, port in (("a_words", "train_words"), ("b_words", "test_words")):
        made = namespace[name]
        assert (made != words(step, port).values).nnz == 0  # type: ignore[operator]


def test_the_worker_stores_the_words_and_reads_them_back(tmp_path: Path) -> None:
    step = load_operators(Path(__file__).parents[2])["sprisk.clean.vectorize_text@1.0.0"]
    paths = {}
    for port, rows in (("train", TRAIN), ("test", TEST)):
        paths[port] = tmp_path / f"{port}.parquet"
        rows.write_parquet(paths[port])
    out_dir = tmp_path / "out"
    out_dir.mkdir()

    written = {o.port: o for o in step.run({"columns": ["title"]}, paths, out_dir)}

    assert written["train_words"].media_type == MATRIX
    stored = read_matrix(written["train_words"].path)
    expected = words(vectorize_text(TRAIN, TEST, columns=["title"]), "train_words")
    assert stored.columns == expected.columns
    assert (stored.values != expected.values).nnz == 0
