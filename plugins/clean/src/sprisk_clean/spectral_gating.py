from typing import Any

import plotly.graph_objects as go
import polars as pl


def spectral_gating(
    train: pl.DataFrame,
    test: pl.DataFrame,
    signal_column: str,
    snr_column: str,
    threshold_db: float = 0.0,
    attenuation_factor: float = 0.15,
) -> dict[str, Any]:
    """Adaptive spectral noise gating applied to signal amplitude features.

    Learns the noise baseline distribution from train frames and suppresses sub-threshold
    spectral energy consistently across train and test partitions (preventing leakage).
    """
    if signal_column not in train.schema:
        raise ValueError(f"signal column '{signal_column}' not found in train schema")
    if snr_column not in train.schema:
        raise ValueError(f"SNR column '{snr_column}' not found in train schema")

    # The noise floor is learned from train only, so test frames never shape their own gain.
    noise_floor = train[snr_column].min()

    def _apply_gate(df: pl.DataFrame) -> pl.DataFrame:
        # Linear ramp from attenuation_factor at the train noise floor up to 1.0 at threshold_db.
        gate_gain = (
            pl.when(pl.col(snr_column) < threshold_db)
            .then(
                pl.lit(attenuation_factor)
                + (1.0 - attenuation_factor)
                * (pl.col(snr_column) - noise_floor)
                / (threshold_db - noise_floor + 1e-6)
            )
            .otherwise(pl.lit(1.0))
            .clip(attenuation_factor, 1.0)
        )
        return df.with_columns(
            (pl.col(signal_column) * gate_gain).alias(signal_column),
            gate_gain.alias("spectral_gate_gain"),
        )

    out_train = _apply_gate(train)
    out_test = _apply_gate(test)
    figure = _spectral_gate_figure(
        train=train,
        gated_train=out_train,
        signal_column=signal_column,
        snr_column=snr_column,
        threshold_db=threshold_db,
        attenuation_factor=attenuation_factor,
    )

    return {
        "train": out_train,
        "test": out_test,
        "figures": [figure],
    }


def _spectral_gate_figure(
    train: pl.DataFrame,
    gated_train: pl.DataFrame,
    signal_column: str,
    snr_column: str,
    threshold_db: float,
    attenuation_factor: float,
) -> go.Figure:
    sub = gated_train.head(150)
    orig_sub = train.head(150)
    x_vals = (
        sub["sample_time"].to_list() if "sample_time" in sub.schema else list(range(sub.height))
    )
    x_label = "Time (seconds)" if "sample_time" in sub.schema else "Frame Index"

    fig = go.Figure()
    fig.add_trace(
        go.Scatter(
            x=x_vals,
            y=orig_sub[signal_column].to_list(),
            mode="lines",
            name="Raw Input Signal",
            line=dict(color="#64748b", width=1.5),
            opacity=0.7,
        )
    )
    fig.add_trace(
        go.Scatter(
            x=x_vals,
            y=sub[signal_column].to_list(),
            mode="lines",
            name="Spectral Gated Signal",
            line=dict(color="#38bdf8", width=2),
        )
    )
    fig.add_trace(
        go.Scatter(
            x=x_vals,
            y=sub["spectral_gate_gain"].to_list(),
            mode="lines",
            name="Gate Gain Multiplier",
            line=dict(color="#f59e0b", width=1.5, dash="dash"),
            yaxis="y2",
        )
    )
    fig.update_layout(
        title=f"Spectral Noise Gating (Threshold {threshold_db:.1f} dB, Floor {attenuation_factor:.2f}×)",
        xaxis=dict(title=x_label),
        yaxis=dict(title="Amplitude"),
        yaxis2=dict(
            title="Gate Gain",
            overlaying="y",
            side="right",
            range=[0, 1.1],
            showgrid=False,
        ),
        legend=dict(orientation="h", yanchor="bottom", y=1.02, xanchor="right", x=1),
        margin=dict(l=40, r=40, t=50, b=40),
    )
    return fig
