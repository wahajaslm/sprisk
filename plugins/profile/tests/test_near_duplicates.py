import polars as pl
import pytest

from sprisk_profile.near_duplicates import near_duplicates

KIND = "data.near_duplicate_groups"


def test_titles_matching_once_case_accents_and_punctuation_go_share_a_group() -> None:
    data = pl.DataFrame(
        {
            "designation": ["Jeu vidéo PRO", "jeu video pro!", "Lampe", "Jeu  Vidéo pro", "Tasse"],
            "prdtypecode": [40, 40, 2060, 40, 2060],
        }
    )
    found = near_duplicates(data, title_column="designation")

    groups = found["data"]["item_group"].to_list()
    assert groups[0] == groups[1] == groups[3]
    assert len({groups[0], groups[2], groups[4]}) == 3
    assert found["data"].drop("item_group").equals(data)
    assert found["evidence"] == {
        KIND: {"rows": 5, "groups": 1, "rows_in_groups": 3, "largest_group": 3}
    }


def test_rows_with_no_title_are_each_their_own_item() -> None:
    data = pl.DataFrame({"designation": [None, None, "", "Lampe"]})
    found = near_duplicates(data, title_column="designation")

    assert found["data"]["item_group"].n_unique() == 4
    assert found["evidence"][KIND]["groups"] == 0
    assert found["evidence"][KIND]["largest_group"] == 1


def test_titles_in_other_scripts_keep_their_letters() -> None:
    data = pl.DataFrame({"designation": ["Чашка", "чашка", "Лампа"]})
    found = near_duplicates(data, title_column="designation")
    assert found["evidence"][KIND]["rows_in_groups"] == 2


def test_a_table_that_already_has_the_group_column_is_refused() -> None:
    data = pl.DataFrame({"designation": ["a"], "item_group": [1]})
    with pytest.raises(ValueError, match="already has a column item_group"):
        near_duplicates(data, title_column="designation")


def test_a_title_column_that_is_not_text_is_refused() -> None:
    data = pl.DataFrame({"designation": [1, 2]})
    with pytest.raises(ValueError, match="designation holds Int64, not text"):
        near_duplicates(data, title_column="designation")
