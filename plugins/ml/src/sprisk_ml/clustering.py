"""Clustering operators for unsupervised pattern discovery."""

from typing import Literal

import polars as pl
from sklearn.cluster import DBSCAN, KMeans
from sklearn.mixture import GaussianMixture


def kmeans(
    data: pl.DataFrame,
    n_clusters: int,
    n_init: int = 10,
    max_iter: int = 300,
    seed: int = 42,
) -> pl.DataFrame:
    """Partition numerical features into K convex Voronoi clusters."""
    numeric_cols = [
        col
        for col, dtype in zip(data.columns, data.dtypes, strict=False)
        if dtype.is_numeric()
    ]
    if not numeric_cols:
        raise ValueError("KMeans requires at least one numeric feature column")
    x = data.select(numeric_cols).to_numpy()
    model = KMeans(
        n_clusters=n_clusters, n_init=n_init, max_iter=max_iter, random_state=seed
    )
    labels = model.fit_predict(x)
    return data.with_columns(pl.Series("cluster", labels, dtype=pl.Int32))


def dbscan(
    data: pl.DataFrame,
    eps: float,
    min_samples: int,
) -> pl.DataFrame:
    """Discover arbitrary non-convex density clusters and isolate noise (-1)."""
    numeric_cols = [
        col
        for col, dtype in zip(data.columns, data.dtypes, strict=False)
        if dtype.is_numeric()
    ]
    if not numeric_cols:
        raise ValueError("DBSCAN requires at least one numeric feature column")
    x = data.select(numeric_cols).to_numpy()
    model = DBSCAN(eps=eps, min_samples=min_samples)
    labels = model.fit_predict(x)
    return data.with_columns(pl.Series("cluster", labels, dtype=pl.Int32))


def gmm(
    data: pl.DataFrame,
    n_components: int,
    covariance_type: Literal["full", "tied", "diag", "spherical"] = "full",
    seed: int = 42,
) -> pl.DataFrame:
    """Fit a mixture of K Gaussians and assign cluster labels by maximum posterior probability."""
    numeric_cols = [
        col
        for col, dtype in zip(data.columns, data.dtypes, strict=False)
        if dtype.is_numeric()
    ]
    if not numeric_cols:
        raise ValueError("GaussianMixture requires at least one numeric feature column")
    x = data.select(numeric_cols).to_numpy()
    model = GaussianMixture(
        n_components=n_components, covariance_type=covariance_type, random_state=seed
    )
    labels = model.fit_predict(x)
    return data.with_columns(pl.Series("cluster", labels, dtype=pl.Int32))
