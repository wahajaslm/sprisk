import polars as pl
import pytest

from sprisk_clean.strip_html import strip_html


def test_tags_become_spaces_and_entities_become_their_characters() -> None:
    data = pl.DataFrame(
        {
            "description": [
                "Lot de 2<br />neuf",
                "<p>Caf&eacute; <b>moulu</b></p>",
                "&#233;t&#xE9; &amp; hiver",
                None,
            ],
            "n": [1, 2, 3, 4],
        }
    )
    out = strip_html(data, columns=["description"])
    assert out["description"].to_list() == ["Lot de 2 neuf", "Café moulu", "été & hiver", None]
    assert out["n"].to_list() == [1, 2, 3, 4], "other columns untouched"


def test_text_that_only_looks_like_markup_stays() -> None:
    data = pl.DataFrame({"t": ["AT&T 5 < 7 et 9 > 3", "Paris"]})
    assert strip_html(data, columns=["t"])["t"].to_list() == ["AT&T 5 < 7 et 9 > 3", "Paris"]


def test_scripts_and_styles_are_dropped_with_their_code() -> None:
    data = pl.DataFrame({"t": ["a<script>var x = 1;</script>b<style>p {}</style>c"]})
    assert strip_html(data, columns=["t"])["t"].to_list() == ["a b c"]


def test_a_value_that_was_only_markup_becomes_blank_not_missing() -> None:
    data = pl.DataFrame({"t": ["<br />", "&nbsp;"]})
    assert strip_html(data, columns=["t"])["t"].to_list() == ["", ""]


def test_a_column_that_is_not_text_is_an_error() -> None:
    with pytest.raises(ValueError, match="n is not a text column"):
        strip_html(pl.DataFrame({"n": [1]}), columns=["n"])


def test_a_missing_column_is_an_error() -> None:
    with pytest.raises(pl.exceptions.ColumnNotFoundError):
        strip_html(pl.DataFrame({"t": ["a"]}), columns=["gone"])


def test_only_entities_ending_in_a_semicolon_are_decoded() -> None:
    data = pl.DataFrame({"t": ["Ben&nothing <br />", "&copy2020 &amp; prix &lt 5<br />"]})
    assert strip_html(data, columns=["t"])["t"].to_list() == [
        "Ben&nothing",
        "&copy2020 & prix &lt 5",
    ]


def test_an_unclosed_bracket_keeps_the_text_after_it() -> None:
    data = pl.DataFrame({"t": ["Dimensions 10<x cm<br />", "a <b c"]})
    assert strip_html(data, columns=["t"])["t"].to_list() == ["Dimensions 10<x cm", "a <b c"]


def test_comments_go_and_values_without_markup_are_left_exactly_as_they_are() -> None:
    data = pl.DataFrame({"t": ["<!-- c -->texte", "  deux   espaces ", "&lt;b&gt;"]})
    assert strip_html(data, columns=["t"])["t"].to_list() == ["texte", "  deux   espaces ", "<b>"]


def test_the_step_strips_what_the_profile_counts_as_html() -> None:
    from sprisk_clean.strip_html import ENTITY, TAG
    from sprisk_profile.dataset import HTML

    assert f"{TAG}|{ENTITY}" == HTML


def test_an_unknown_entity_name_stays_whole() -> None:
    data = pl.DataFrame({"t": ["&copyright; &notanentity; &eacute;", "&ampx;"]})
    assert strip_html(data, columns=["t"])["t"].to_list() == [
        "&copyright; &notanentity; é",
        "&ampx;",
    ]
