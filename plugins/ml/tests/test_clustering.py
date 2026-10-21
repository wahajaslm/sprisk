"""Unit tests for KMeans, DBSCAN, and GMM clustering operators."""

import polars as pl
import pytest
from sprisk_ml.clustering import dbscan, gmm, kmeans


@pytest.fixture
def numeric_data() -> pl.DataFrame:
    return pl.DataFrame(
        {
            "x": [1.0, 1.1, 1.2, 8.0, 8.1, 8.2, 100.0],
            "y": [1.0, 0.9, 1.1, 8.0, 7.9, 8.1, 100.0],
            "category": ["a", "a", "b", "c", "c", "d", "e"],
        }
    )


def test_kmeans_assigns_cluster_labels(numeric_data: pl.DataFrame) -> None:
    res = kmeans(numeric_data, n_clusters=2, seed=42)
    assert "cluster" in res.columns
    assert res["cluster"].n_unique() == 2
    assert len(res) == len(numeric_data)


def test_dbscan_finds_clusters_and_noise(numeric_data: pl.DataFrame) -> None:
    res = dbscan(numeric_data, eps=0.5, min_samples=2)
    assert "cluster" in res.columns
    assert len(res) == len(numeric_data)
    # The outlier (100.0, 100.0) should be marked as noise (-1)
    assert res["cluster"][-1] == -1


def test_gmm_fits_components(numeric_data: pl.DataFrame) -> None:
    res = gmm(numeric_data, n_components=2, seed=42)
    assert "cluster" in res.columns
    assert res["cluster"].n_unique() == 2
    assert len(res) == len(numeric_data)
