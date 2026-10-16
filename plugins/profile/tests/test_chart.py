import polars as pl
import pytest

from sprisk_profile.chart import aggregate, chart

DATA = pl.DataFrame(
    {
        "mass": [3000.0, 3500.0, 4000.0, 4500.0, 5000.0, None],
        "species": ["a", "a", "b", "b", "c", "c"],
        "flipper": [180.0, 185.0, 200.0, 210.0, 220.0, 230.0],
    }
)


def test_histogram_counts_every_present_value_in_equal_bins() -> None:
    out = aggregate(DATA, kind="histogram", x="mass", bins=4)
    assert out["kind"] == "histogram" and out["x"] == "mass"
    assert [b["count"] for b in out["bins"]] == [1, 1, 1, 2]
    assert out["bins"][0]["lower"] == 3000.0 and out["bins"][-1]["upper"] == 5000.0
    assert out["missing"] == 1


def test_box_gives_quartiles_per_group() -> None:
    out = aggregate(DATA, kind="box", x="species", y="flipper")
    groups = {g["group"]: g for g in out["groups"]}
    assert groups["a"]["min"] == 180.0 and groups["a"]["max"] == 185.0
    assert groups["b"]["median"] == pytest.approx(205.0)
    assert set(groups) == {"a", "b", "c"}


def test_box_of_one_column_is_one_group() -> None:
    [only] = aggregate(DATA, kind="box", x="flipper")["groups"]
    assert only["n"] == 6


def test_scatter_keeps_pairs_and_caps_points_with_a_fixed_sample() -> None:
    big = pl.DataFrame({"a": list(range(5000)), "b": list(range(5000))})
    first = aggregate(big, kind="scatter", x="a", y="b", max_points=100)
    again = aggregate(big, kind="scatter", x="a", y="b", max_points=100)
    assert len(first["points"]) == 100 and first["points"] == again["points"]
    assert first["sampled"] is True
    assert all(p[0] == p[1] for p in first["points"])


def test_bar_counts_rows_per_category_or_averages_y() -> None:
    counts = {b["x"]: b["value"] for b in aggregate(DATA, kind="bar", x="species")["bars"]}
    assert counts == {"a": 2, "b": 2, "c": 2}
    means = {
        b["x"]: b["value"] for b in aggregate(DATA, kind="bar", x="species", y="flipper")["bars"]
    }
    assert means["c"] == pytest.approx(225.0)


def test_line_is_sorted_by_x() -> None:
    shuffled = pl.DataFrame({"t": [3, 1, 2], "v": [30.0, 10.0, 20.0]})
    assert aggregate(shuffled, kind="line", x="t", y="v")["points"] == [
        [1, 10.0],
        [2, 20.0],
        [3, 30.0],
    ]


@pytest.mark.parametrize(
    ("kind", "x", "y", "message"),
    [
        ("histogram", "species", None, "species is not numeric"),
        ("scatter", "mass", None, "scatter needs y"),
        ("line", "mass", None, "line needs y"),
    ],
)
def test_impossible_charts_say_why(kind: str, x: str, y: str | None, message: str) -> None:
    with pytest.raises(ValueError, match=message):
        aggregate(DATA, kind=kind, x=x, y=y)


def test_a_line_over_dates_gives_iso_dates() -> None:
    import datetime as dt

    days = pl.DataFrame({"day": [dt.date(2026, 1, 2), dt.date(2026, 1, 1)], "v": [2.0, 1.0]})
    out = aggregate(days, kind="line", x="day", y="v")
    assert out["points"] == [["2026-01-01", 1.0], ["2026-01-02", 2.0]]


def test_scatter_of_text_says_why() -> None:
    with pytest.raises(ValueError, match="species is not numeric"):
        aggregate(DATA, kind="scatter", x="species", y="mass")


@pytest.mark.parametrize(
    ("kind", "x", "y", "trace"),
    [
        ("histogram", "mass", None, "bar"),
        ("box", "species", "flipper", "box"),
        ("scatter", "flipper", "mass", "scatter"),
        ("bar", "species", None, "bar"),
        ("line", "flipper", "mass", "scatter"),
    ],
)
def test_chart_draws_a_plotly_figure_titled_by_its_columns(
    kind: str, x: str, y: str | None, trace: str
) -> None:
    figure = chart(DATA, kind=kind, x=x, y=y)
    assert figure.data[0].type == trace
    assert x in figure.layout.title.text
