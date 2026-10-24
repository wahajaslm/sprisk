import json
from pathlib import Path

import polars as pl

from sprisk_profile.spelling_variants import spelling_variants
from sprisk_workers.manifests import load_operators

KIND = "data.spelling_variants"


def test_a_category_typed_several_ways_is_named_to_merge() -> None:
    data = pl.DataFrame({"city": ["Paris", "paris ", "PARIS", "Lyon", "Lyon", "Nice"] * 4})
    found = spelling_variants(data)[KIND]
    assert found["columns"] == ["city"]
    assert found["identifier_like"] == []


def test_free_text_is_left_to_the_text_steps() -> None:
    # Titles hold several words each: free text, which word features read without case.
    titles = [f"Jeu vidéo pro {i}" for i in range(20)] + [f"jeu vidéo PRO {i}" for i in range(20)]
    found = spelling_variants(pl.DataFrame({"designation": titles}))[KIND]
    assert found["columns"] == []
    assert found["accent_only"] == []


def test_an_identifier_differing_only_in_case_is_named_but_never_merged() -> None:
    codes = [f"AB{i:03d}" for i in range(40)] + ["ab001"]
    found = spelling_variants(pl.DataFrame({"sku": codes}))[KIND]
    assert found["columns"] == []
    assert found["identifier_like"] == ["sku"]


def test_values_differing_only_in_accents_are_named_not_merged() -> None:
    data = pl.DataFrame({"colour": ["café", "cafe", "noir", "noir"] * 5})
    found = spelling_variants(data)[KIND]
    assert found["columns"] == []
    assert found["accent_only"] == ["colour"]


def test_columns_that_are_not_text_are_not_read() -> None:
    found = spelling_variants(pl.DataFrame({"n": [1, 2, 2], "flag": [True, False, True]}))[KIND]
    assert found == {"columns": [], "identifier_like": [], "accent_only": [], "text_columns": 0}


def test_the_worker_stores_one_evidence_set(tmp_path: Path) -> None:
    step = load_operators(Path(__file__).parents[2])["sprisk.profile.spelling_variants@1.0.0"]
    source = tmp_path / "data.parquet"
    pl.DataFrame({"city": ["Paris", "paris", "Lyon"]}).write_parquet(source)
    out = tmp_path / "out"
    out.mkdir()
    written = {o.port: o for o in step.run({}, {"data": source}, out)}
    assert list(json.loads(written["evidence"].path.read_text())) == [KIND]
