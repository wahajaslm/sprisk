"""Deterministic audit and feature extraction for row-linked audio assets."""

from __future__ import annotations

from collections import Counter
from pathlib import Path
from typing import Any

import numpy as np
import polars as pl
import soundfile as sf
import librosa
from scipy import sparse
from librosa.util.exceptions import ParameterError

AUDIT_KIND = "audio.asset_quality"

MFCC_NAMES = tuple(f"audio_mfcc_{index:02d}_{stat}" for index in range(1, 14) for stat in ("mean", "std"))
CHROMA_NAMES = tuple(f"audio_chroma_{index:02d}_{stat}" for index in range(1, 13) for stat in ("mean", "std"))
SPECTRAL_NAMES = tuple(
    f"audio_{feature}_{stat}"
    for feature in ("spectral_centroid_hz", "spectral_bandwidth_hz", "spectral_rolloff_hz", "spectral_flatness", "rms", "zero_crossing_rate")
    for stat in ("mean", "std")
)
CONTRAST_NAMES = tuple(f"audio_spectral_contrast_band_{index}" for index in range(1, 8))
AUDIO_FEATURE_NAMES = MFCC_NAMES + CHROMA_NAMES + SPECTRAL_NAMES + CONTRAST_NAMES + ("audio_tempo_bpm",)


def audit_audio(
    data: pl.DataFrame, audio_dir: str, audio_path_column: str
) -> dict[str, Any]:
    """Report decode coverage and acoustically meaningful quality measures.

    Paths are relative to ``audio_dir`` and are rejected if they escape it.  The audit sees
    samples, never labels, so it is valid before the train/test split.
    """
    root = Path(audio_dir).resolve()
    if not root.is_dir():
        raise ValueError(f"audio_dir is not a directory: {audio_dir}")
    if audio_path_column not in data.columns:
        raise ValueError(f"{audio_path_column!r} is not a column of the data")
    values = _measure(data[audio_path_column].to_list(), root)
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
            "coverage": _share(len(decoded), data.height),
            "duration_seconds": _summary(durations),
            "sample_rates": dict(sorted(Counter(rates).items())),
            "channels": dict(sorted(Counter(channels).items())),
            "silence_share": _summary(silence),
            "clipping_share": _summary(clipping),
        }
    }


def featurize_audio(
    train: pl.DataFrame,
    test: pl.DataFrame,
    audio_dir: str,
    audio_path_column: str,
    train_words: tuple[Any, tuple[str, ...]] | None = None,
    test_words: tuple[Any, tuple[str, ...]] | None = None,
) -> dict[str, Any]:
    """Append deterministic acoustic descriptors to optional text features.

    Features are extracted with librosa and have no fitted state or hidden download: 13 MFCCs,
    12 chroma bins, spectral centroid/bandwidth/rolloff/flatness/contrast, RMS,
    zero-crossing rate and tempo. Missing/unreadable assets produce all-zero rows and evidence.
    """
    root = Path(audio_dir).resolve()
    if not root.is_dir():
        raise ValueError(f"audio_dir is not a directory: {audio_dir}")
    for frame, name in ((train, "train"), (test, "test")):
        if audio_path_column not in frame.columns:
            raise ValueError(f"{audio_path_column!r} is not a column of the {name} rows")
    train_values, train_state = _features(train[audio_path_column].to_list(), root)
    test_values, test_state = _features(test[audio_path_column].to_list(), root)
    train_matrix, train_names = _append(train_values, AUDIO_FEATURE_NAMES, train_words)
    test_matrix, test_names = _append(test_values, AUDIO_FEATURE_NAMES, test_words)
    if train_names != test_names:
        raise ValueError("train and test audio features differ")
    return {
        "train": train,
        "test": test,
        "train_words": (train_matrix, train_names),
        "test_words": (test_matrix, test_names),
        "evidence": {"audio.feature_coverage": {"train": train_state, "test": test_state}},
    }


def _measure(paths: list[object], root: Path) -> dict[str, Any]:
    decoded: list[dict[str, float | int]] = []
    missing = unreadable = 0
    for raw in paths:
        path = _path(root, raw)
        if path is None or not path.is_file():
            missing += 1
            continue
        try:
            samples, rate = sf.read(path, always_2d=True, dtype="float32")
        except (RuntimeError, OSError):
            unreadable += 1
            continue
        decoded.append(_metrics(samples, int(rate)))
    return {"decoded": decoded, "missing": missing, "unreadable": unreadable}


def _features(paths: list[object], root: Path) -> tuple[np.ndarray, dict[str, int]]:
    matrix = np.zeros((len(paths), len(AUDIO_FEATURE_NAMES)), dtype=np.float32)
    missing = unreadable = found = 0
    for row, raw in enumerate(paths):
        path = _path(root, raw)
        if path is None or not path.is_file():
            missing += 1
            continue
        try:
            samples, rate = sf.read(path, always_2d=True, dtype="float32")
        except (RuntimeError, OSError):
            unreadable += 1
            continue
        matrix[row] = _librosa_features(samples.mean(axis=1), int(rate))
        found += 1
    return matrix, {"rows": len(paths), "found": found, "missing": missing, "unreadable": unreadable}


def _metrics(samples: np.ndarray, rate: int) -> dict[str, float | int]:
    mono = samples.mean(axis=1) if samples.size else np.empty(0, dtype=np.float32)
    duration = len(mono) / rate if rate else 0.0
    rms = float(np.sqrt(np.mean(mono * mono))) if len(mono) else 0.0
    silence = float(np.mean(np.abs(mono) <= 1e-3)) if len(mono) else 1.0
    clipping = float(np.mean(np.abs(mono) >= 0.999)) if len(mono) else 0.0
    crossings = float(np.mean(mono[1:] * mono[:-1] < 0)) if len(mono) > 1 else 0.0
    if len(mono) > 1:
        spectrum = np.abs(np.fft.rfft(mono))
        frequencies = np.fft.rfftfreq(len(mono), d=1.0 / rate)
        centroid = float((frequencies * spectrum).sum() / spectrum.sum()) if spectrum.sum() else 0.0
    else:
        centroid = 0.0
    return {"duration_seconds": duration, "sample_rate": rate, "channels": samples.shape[1], "rms": rms,
            "silence_share": silence, "clipping_share": clipping, "zero_crossing_rate": crossings,
            "spectral_centroid_hz": centroid}


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
    try:
        contrast = librosa.feature.spectral_contrast(y=mono, sr=rate, n_bands=6)
        values.extend(contrast.mean(axis=1).tolist())
    except (ValueError, ParameterError, np.linalg.LinAlgError):
        values.extend([0.0] * 7)
    try:
        tempo = float(np.asarray(librosa.feature.tempo(y=mono, sr=rate)).reshape(-1)[0])
    except (ValueError, ParameterError, np.linalg.LinAlgError, IndexError):
        tempo = 0.0
    values.append(tempo)
    return np.asarray(values, dtype=np.float32)


def _path(root: Path, raw: object) -> Path | None:
    candidate = (root / str(raw)).resolve()
    return candidate if candidate.is_relative_to(root) else None


def _summary(values: list[float | int]) -> dict[str, float] | None:
    if not values:
        return None
    array = np.asarray(values, dtype=np.float64)
    return {"min": float(array.min()), "median": float(np.median(array)), "max": float(array.max())}


def _share(part: int, total: int) -> float:
    return 0.0 if total == 0 else part / total


def _append(values: np.ndarray, names: tuple[str, ...], existing: tuple[Any, tuple[str, ...]] | None) -> tuple[sparse.csr_matrix, tuple[str, ...]]:
    features = sparse.csr_matrix(values)
    if existing is None:
        return features, names
    matrix, previous = existing
    return sparse.hstack([matrix, features], format="csr"), tuple(previous) + names
