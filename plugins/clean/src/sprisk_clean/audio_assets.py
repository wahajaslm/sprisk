"""Deterministic audit and feature extraction for row-linked audio assets."""

from __future__ import annotations

import hashlib
from collections import Counter
from pathlib import Path
from typing import Any

import av
import numpy as np
import polars as pl
import soundfile as sf
import librosa
from scipy import sparse
from librosa.util.exceptions import ParameterError
from sklearn.preprocessing import StandardScaler

AUDIT_KIND = "audio.asset_quality"
COPIES_KIND = "audio.recording_copies"
# Copies are compared on 16 kHz mono 16-bit samples: one file decodes the same each time, and
# the rounding hides float noise between decoders.
HASH_RATE = 16_000

MFCC_NAMES = tuple(f"audio_mfcc_{index:02d}_{stat}" for index in range(1, 14) for stat in ("mean", "std"))
CHROMA_NAMES = tuple(f"audio_chroma_{index:02d}_{stat}" for index in range(1, 13) for stat in ("mean", "std"))
SPECTRAL_NAMES = tuple(
    f"audio_{feature}_{stat}"
    for feature in ("spectral_centroid_hz", "spectral_bandwidth_hz", "spectral_rolloff_hz", "spectral_flatness", "rms", "zero_crossing_rate")
    for stat in ("mean", "std")
)
CONTRAST_NAMES = tuple(f"audio_spectral_contrast_band_{index}" for index in range(1, 8))
# librosa counts frames in samples, so one rate keeps features comparable across files.
# 22.05 kHz is librosa's default and keeps content up to 11 kHz.
FEATURE_RATE = 22_050
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


def recording_copies(data: pl.DataFrame, audio_dir: str, audio_path_column: str) -> dict[str, Any]:
    """Count rows whose audio repeats an earlier row's, by a hash of the decoded samples.

    One file listed twice, or one recording saved under two names, is one recording: its rows
    on both sides of a split score the model on a sound it heard. Example: rows a.wav, b.wav (a
    copy of a.wav) and a.wav again give copies 2, groups 1, largest_group 3. Labels are never
    read, so the count is valid before the split.
    """
    root = _root(audio_dir, data, audio_path_column)
    hashes, missing, unreadable = _hashes(data[audio_path_column].to_list(), root)
    sizes = Counter(h for h in hashes if h is not None)
    repeated = [n for n in sizes.values() if n > 1]
    return {
        COPIES_KIND: {
            "rows": data.height,
            "hashed": sum(sizes.values()),
            "missing": missing,
            "unreadable": unreadable,
            "copies": sum(n - 1 for n in repeated),
            "groups": len(repeated),
            "largest_group": max(sizes.values(), default=0),
        }
    }


def drop_recording_copies(
    data: pl.DataFrame, audio_dir: str, audio_path_column: str
) -> dict[str, pl.DataFrame]:
    """Keep the first row of each recording, in row order; a row is kept when its file cannot
    be read, since nothing shows it copies another. The first row is kept whatever its label,
    so the choice never looks at the target."""
    root = _root(audio_dir, data, audio_path_column)
    hashes, _, _ = _hashes(data[audio_path_column].to_list(), root)
    seen: set[str] = set()
    keep: list[bool] = []
    for value in hashes:
        keep.append(value is None or value not in seen)
        if value is not None:
            seen.add(value)
    return {"data": data.filter(pl.Series(keep))}


def _root(audio_dir: str, data: pl.DataFrame, audio_path_column: str) -> Path:
    root = Path(audio_dir).resolve()
    if not root.is_dir():
        raise ValueError(f"audio_dir is not a directory: {audio_dir}")
    if audio_path_column not in data.columns:
        raise ValueError(f"{audio_path_column!r} is not a column of the data")
    return root


def _hashes(paths: list[object], root: Path) -> tuple[list[str | None], int, int]:
    """A hash per row (None when the file is missing or unreadable), and those two counts. A
    file listed several times is decoded once."""
    by_path: dict[Path, str | None] = {}
    hashes: list[str | None] = []
    missing = unreadable = 0
    for raw in paths:
        path = _path(root, raw)
        if path is None or not path.is_file():
            missing += 1
            hashes.append(None)
            continue
        if path not in by_path:
            try:
                samples, _ = read_audio(path, rate=HASH_RATE, mono=True)
                pcm = np.round(np.clip(samples[:, 0], -1.0, 1.0) * 32767).astype("<i2")
                by_path[path] = hashlib.sha256(pcm.tobytes()).hexdigest()
            except OSError:
                by_path[path] = None
        if by_path[path] is None:
            unreadable += 1
        hashes.append(by_path[path])
    return hashes, missing, unreadable


def featurize_audio(
    train: pl.DataFrame,
    test: pl.DataFrame,
    audio_dir: str,
    audio_path_column: str,
    train_words: tuple[Any, tuple[str, ...]] | None = None,
    test_words: tuple[Any, tuple[str, ...]] | None = None,
) -> dict[str, Any]:
    """Append deterministic acoustic descriptors to optional text features.

    Features are extracted with librosa with no hidden download: 13 MFCCs, 12 chroma bins,
    spectral centroid/bandwidth/rolloff/flatness/contrast, RMS, zero-crossing rate and tempo.
    Each column is then centred and scaled by the train rows that decoded; that mean and spread
    is the only fitted state. Raw, tempo sits near 120 and flatness near 0.01, which stalls a
    linear model. Missing/unreadable assets land on the train mean (all zeros) and are reported.
    """
    root = Path(audio_dir).resolve()
    if not root.is_dir():
        raise ValueError(f"audio_dir is not a directory: {audio_dir}")
    for frame, name in ((train, "train"), (test, "test")):
        if audio_path_column not in frame.columns:
            raise ValueError(f"{audio_path_column!r} is not a column of the {name} rows")
    train_values, train_found, train_state = _features(train[audio_path_column].to_list(), root)
    test_values, test_found, test_state = _features(test[audio_path_column].to_list(), root)
    if train_found.any():
        scaler = StandardScaler().fit(train_values[train_found])
        train_values = _scaled(scaler, train_values, train_found)
        test_values = _scaled(scaler, test_values, test_found)
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
            samples, rate = read_audio(path)
        except OSError:
            unreadable += 1
            continue
        decoded.append(_metrics(samples, rate))
    return {"decoded": decoded, "missing": missing, "unreadable": unreadable}


def read_audio(path: Path, rate: int | None = None, mono: bool = False) -> tuple[np.ndarray, int]:
    """Decode a file to float32 samples shaped (frames, channels).

    libsndfile reads WAV, FLAC and OGG. Anything else, such as AAC in a YouTube .m4a, goes
    through PyAV's bundled FFmpeg. With `rate` and `mono`, the file is converted while it is
    decoded, so a step never holds more than it analyses. Example: a 44.1 kHz stereo .m4a read
    with rate=22050, mono=True returns shape (n, 1) and 22050; read plainly, (2n, 2) and 44100.
    Raises OSError when neither can decode the file.
    """
    try:
        samples, native = sf.read(path, always_2d=True, dtype="float32")
    except (RuntimeError, OSError):
        return _read_with_ffmpeg(path, rate, mono)
    if mono:
        samples = samples.mean(axis=1, keepdims=True)
    if rate is None or rate == native:
        return samples, int(native)
    converted = librosa.resample(samples.T, orig_sr=native, target_sr=rate).T
    return np.ascontiguousarray(converted, dtype=np.float32), rate


def _read_with_ffmpeg(path: Path, rate: int | None, mono: bool) -> tuple[np.ndarray, int]:
    try:
        with av.open(str(path)) as container:
            stream = container.streams.audio[0]
            target = rate or stream.rate
            planar = av.AudioResampler(
                format="fltp", layout="mono" if mono else stream.layout, rate=target
            )
            chunks = [
                out.to_ndarray()
                for frame in container.decode(stream)
                for out in planar.resample(frame)
            ]
            chunks += [out.to_ndarray() for out in planar.resample(None)]
            return np.concatenate(chunks, axis=1).T.astype(np.float32), int(target)
    except (av.FFmpegError, IndexError, ValueError) as error:
        raise OSError(f"cannot decode {path.name}") from error


def _features(
    paths: list[object], root: Path
) -> tuple[np.ndarray, np.ndarray, dict[str, int]]:
    """Raw descriptors per row, which rows decoded, and the coverage counts."""
    matrix = np.zeros((len(paths), len(AUDIO_FEATURE_NAMES)), dtype=np.float32)
    found = np.zeros(len(paths), dtype=bool)
    missing = unreadable = 0
    for row, raw in enumerate(paths):
        path = _path(root, raw)
        if path is None or not path.is_file():
            missing += 1
            continue
        try:
            samples, rate = read_audio(path, rate=FEATURE_RATE, mono=True)
        except OSError:
            unreadable += 1
            continue
        matrix[row] = _librosa_features(samples[:, 0], rate)
        found[row] = True
    counts = {
        "rows": len(paths), "found": int(found.sum()), "missing": missing, "unreadable": unreadable,
    }
    return matrix, found, counts


def _scaled(scaler: StandardScaler, values: np.ndarray, found: np.ndarray) -> np.ndarray:
    """Train-fitted scaling; rows that did not decode sit at the train mean, which is zero."""
    return np.where(found[:, None], scaler.transform(values), 0).astype(np.float32)


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
