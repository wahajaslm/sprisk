"""Deterministic audit and feature extraction for row-linked audio assets."""

from __future__ import annotations

from collections import Counter
from enum import Enum
from pathlib import Path
from typing import Any

import numpy as np
import polars as pl

from .row_assets import append_features, asset_root, confined_path, file_names, share, summary

try:
    import librosa
    import soundfile as sf
    from librosa.util.exceptions import ParameterError
except ImportError as error:
    raise ImportError(
        "audio operators need the audio extra: install sprisk-clean[audio]"
    ) from error

AUDIT_KIND = "audio.asset_quality"

MFCC_NAMES = tuple(
    f"audio_mfcc_{index:02d}_{stat}" for index in range(1, 14) for stat in ("mean", "std")
)
CHROMA_NAMES = tuple(
    f"audio_chroma_{index:02d}_{stat}" for index in range(1, 13) for stat in ("mean", "std")
)
SPECTRAL_NAMES = tuple(
    f"audio_{feature}_{stat}"
    for feature in (
        "spectral_centroid_hz",
        "spectral_bandwidth_hz",
        "spectral_rolloff_hz",
        "spectral_flatness",
        "rms",
        "zero_crossing_rate",
    )
    for stat in ("mean", "std")
)
CONTRAST_NAMES = tuple(f"audio_spectral_contrast_band_{index}" for index in range(1, 8))
AUDIO_FEATURE_NAMES = (
    MFCC_NAMES + CHROMA_NAMES + SPECTRAL_NAMES + CONTRAST_NAMES + ("audio_tempo_bpm",)
)


def audit_audio(data: pl.DataFrame, audio_dir: Path, file_pattern: str) -> dict[str, Any]:
    """Report decode coverage and acoustically meaningful quality measures.

    Paths are relative to ``audio_dir`` and are rejected if they escape it.  The audit sees
    samples, never labels, so it is valid before the train/test split.
    """
    root = asset_root(audio_dir, "audio_dir")
    values = _measure(file_names(data, file_pattern), root)
    decoded = values["decoded"]
    durations = [item["duration_seconds"] for item in decoded]
    rates = [item["sample_rate"] for item in decoded]
    channels = [item["channels"] for item in decoded]
    silence = [item["silence_share"] for item in decoded]
    clipping = [item["clipping_share"] for item in decoded]
    return {
        AUDIT_KIND: {
            "rows": data.height,
            "found": len(decoded),
            "missing": values["missing"],
            "unreadable": values["unreadable"],
            "coverage": share(len(decoded), data.height),
            "duration_seconds": summary(durations),
            "sample_rates": dict(sorted(Counter(rates).items())),
            "channels": dict(sorted(Counter(channels).items())),
            "silence_share": summary(silence),
            "clipping_share": summary(clipping),
        }
    }


def featurize_audio(
    train: pl.DataFrame,
    test: pl.DataFrame,
    audio_dir: Path,
    file_pattern: str,
    train_words: tuple[Any, tuple[str, ...]] | None = None,
    test_words: tuple[Any, tuple[str, ...]] | None = None,
) -> dict[str, Any]:
    """Append deterministic acoustic descriptors to optional text features.

    Features are extracted with librosa and have no fitted state or hidden download: 13 MFCCs,
    12 chroma bins, spectral centroid/bandwidth/rolloff/flatness/contrast, RMS,
    zero-crossing rate and tempo. Missing/unreadable assets produce all-zero rows and evidence.
    """
    root = asset_root(audio_dir, "audio_dir")
    train_values, train_state = _features(file_names(train, file_pattern), root)
    test_values, test_state = _features(file_names(test, file_pattern), root)
    train_matrix, train_names = append_features(train_values, AUDIO_FEATURE_NAMES, train_words)
    test_matrix, test_names = append_features(test_values, AUDIO_FEATURE_NAMES, test_words)
    if train_names != test_names:
        raise ValueError("train and test audio features differ")
    return {
        "train": train,
        "test": test,
        "train_words": (train_matrix, train_names),
        "test_words": (test_matrix, test_names),
        "evidence": {"audio.feature_coverage": {"train": train_state, "test": test_state}},
    }


class Unavailable(Enum):
    MISSING = "missing"
    UNREADABLE = "unreadable"


def read_clip(root: Path, name: str | None) -> tuple[np.ndarray, int] | Unavailable:
    """A row's clip as (channels-last samples, rate), or why there is none."""
    path = confined_path(root, name)
    if path is None or not path.is_file():
        return Unavailable.MISSING
    try:
        samples, rate = sf.read(path, always_2d=True, dtype="float32")
    except (RuntimeError, OSError):
        return Unavailable.UNREADABLE
    return samples, int(rate)


def _measure(paths: list[str | None], root: Path) -> dict[str, Any]:
    decoded: list[dict[str, float | int]] = []
    counts: Counter[Unavailable] = Counter()
    for raw in paths:
        clip = read_clip(root, raw)
        if isinstance(clip, Unavailable):
            counts[clip] += 1
            continue
        decoded.append(_metrics(*clip))
    return {
        "decoded": decoded,
        "missing": counts[Unavailable.MISSING],
        "unreadable": counts[Unavailable.UNREADABLE],
    }


def _features(paths: list[str | None], root: Path) -> tuple[np.ndarray, dict[str, int]]:
    matrix = np.zeros((len(paths), len(AUDIO_FEATURE_NAMES)), dtype=np.float32)
    counts: Counter[Unavailable] = Counter()
    for row, raw in enumerate(paths):
        clip = read_clip(root, raw)
        if isinstance(clip, Unavailable):
            counts[clip] += 1
            continue
        samples, rate = clip
        try:
            matrix[row] = _librosa_features(samples.mean(axis=1), rate)
        except (ValueError, ParameterError, np.linalg.LinAlgError):
            # Too short to describe: counted, never filled in with zeros as if measured.
            counts[Unavailable.UNREADABLE] += 1
    unavailable = counts[Unavailable.MISSING] + counts[Unavailable.UNREADABLE]
    return matrix, {
        "rows": len(paths),
        "found": len(paths) - unavailable,
        "missing": counts[Unavailable.MISSING],
        "unreadable": counts[Unavailable.UNREADABLE],
    }


def _metrics(samples: np.ndarray, rate: int) -> dict[str, float | int]:
    mono = samples.mean(axis=1) if samples.size else np.empty(0, dtype=np.float32)
    return {
        "duration_seconds": len(mono) / rate if rate else 0.0,
        "sample_rate": rate,
        "channels": samples.shape[1],
        "silence_share": float(np.mean(np.abs(mono) <= 1e-3)) if len(mono) else 1.0,
        "clipping_share": float(np.mean(np.abs(mono) >= 0.999)) if len(mono) else 0.0,
    }


def _librosa_features(mono: np.ndarray, rate: int) -> np.ndarray:
    """Frame-level librosa descriptors reduced to deterministic clip-level statistics."""
    if len(mono) == 0 or rate <= 0:
        return np.zeros(len(AUDIO_FEATURE_NAMES), dtype=np.float32)
    values: list[float] = []
    mfcc = librosa.feature.mfcc(y=mono, sr=rate, n_mfcc=13)
    chroma = librosa.feature.chroma_stft(y=mono, sr=rate, n_chroma=12)
    for array in (mfcc, chroma):
        for row in array:
            values.extend((float(row.mean()), float(row.std())))
    descriptors = (
        librosa.feature.spectral_centroid(y=mono, sr=rate),
        librosa.feature.spectral_bandwidth(y=mono, sr=rate),
        librosa.feature.spectral_rolloff(y=mono, sr=rate),
        librosa.feature.spectral_flatness(y=mono),
        librosa.feature.rms(y=mono),
        librosa.feature.zero_crossing_rate(mono),
    )
    for descriptor in descriptors:
        values.extend((float(descriptor.mean()), float(descriptor.std())))
    contrast = librosa.feature.spectral_contrast(y=mono, sr=rate, n_bands=6)
    values.extend(contrast.mean(axis=1).tolist())
    values.append(float(np.asarray(librosa.feature.tempo(y=mono, sr=rate)).reshape(-1)[0]))
    return np.asarray(values, dtype=np.float32)
