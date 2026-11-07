"""Standard acoustic descriptors and deterministic WebRTC voice-activity evidence."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import librosa
import numpy as np
import opensmile
import polars as pl
import webrtcvad
from scipy import sparse

from .audio_assets import _append, _path, read_audio

VAD_KIND = "audio.speech_activity"


def opensmile_features(
    train: pl.DataFrame,
    test: pl.DataFrame,
    audio_dir: str,
    audio_path_column: str,
    train_words: tuple[Any, tuple[str, ...]] | None = None,
    test_words: tuple[Any, tuple[str, ...]] | None = None,
) -> dict[str, Any]:
    """Append the standard eGeMAPSv02 functional acoustic descriptor set.

    The set is calculated independently for each clip. It has no fitted dataset state; audio
    paths are confined to the declared root and unavailable files become zero rows with evidence.
    """
    root = _root(audio_dir)
    for frame, name in ((train, "train"), (test, "test")):
        if audio_path_column not in frame.columns:
            raise ValueError(f"{audio_path_column!r} is not a column of the {name} rows")
    extractor = opensmile.Smile(
        feature_set=opensmile.FeatureSet.eGeMAPSv02,
        feature_level=opensmile.FeatureLevel.Functionals,
    )
    train_values, names, train_state = _opensmile(train[audio_path_column].to_list(), root, extractor)
    test_values, test_names, test_state = _opensmile(test[audio_path_column].to_list(), root, extractor, names)
    if names != test_names:
        raise ValueError("train and test openSMILE features differ")
    train_matrix, train_names = _append(train_values, names, train_words)
    test_matrix, test_names = _append(test_values, names, test_words)
    if train_names != test_names:
        raise ValueError("train and test audio features differ")
    return {
        "train": train, "test": test,
        "train_words": (train_matrix, train_names), "test_words": (test_matrix, test_names),
        "evidence": {"audio.opensmile_coverage": {
            "feature_set": "eGeMAPSv02", "features": len(names), "train": train_state, "test": test_state,
        }},
    }


def voice_activity(
    data: pl.DataFrame, audio_dir: str, audio_path_column: str, aggressiveness: int = 2
) -> dict[str, Any]:
    """Measure speech segments with local WebRTC VAD, without transcription or speaker identity."""
    root = _root(audio_dir)
    if audio_path_column not in data.columns:
        raise ValueError(f"{audio_path_column!r} is not a column of the data")
    if aggressiveness not in range(4):
        raise ValueError("aggressiveness must be 0, 1, 2, or 3")
    found = missing = unreadable = speech_frames = total_frames = segments = 0
    durations: list[float] = []
    vad = webrtcvad.Vad(aggressiveness)
    for raw in data[audio_path_column].to_list():
        path = _path(root, raw)
        if path is None or not path.is_file():
            missing += 1
            continue
        try:
            samples, rate = read_audio(path, rate=16_000, mono=True)
            flags = _speech_flags(samples[:, 0], rate, vad)
        except (RuntimeError, OSError, ValueError):
            unreadable += 1
            continue
        found += 1
        total_frames += len(flags)
        speech_frames += sum(flags)
        segments += sum(flag and (at == 0 or not flags[at - 1]) for at, flag in enumerate(flags))
        durations.append(len(flags) * 0.03)
    return {VAD_KIND: {
        "rows": data.height, "found": found, "missing": missing, "unreadable": unreadable,
        "frame_seconds": 0.03, "speech_frames": speech_frames, "frames": total_frames,
        "speech_share": 0.0 if total_frames == 0 else speech_frames / total_frames,
        "segments": segments, "analysed_seconds": float(sum(durations)),
        "aggressiveness": aggressiveness,
    }}


def _root(audio_dir: str) -> Path:
    root = Path(audio_dir).resolve()
    if not root.is_dir():
        raise ValueError(f"audio_dir is not a directory: {audio_dir}")
    return root


def _opensmile(
    paths: list[object], root: Path, extractor: opensmile.Smile, expected: tuple[str, ...] | None = None
) -> tuple[np.ndarray, tuple[str, ...], dict[str, int]]:
    rows: list[np.ndarray | None] = []
    names = expected
    missing = unreadable = found = 0
    for raw in paths:
        path = _path(root, raw)
        if path is None or not path.is_file():
            missing += 1
            rows.append(None)
            continue
        try:
            samples, rate = read_audio(path)
            frame = extractor.process_signal(samples.mean(axis=1), rate)
            values = frame.iloc[0].to_numpy(dtype=np.float32)
            observed = tuple(f"audio_egemaps_{name}" for name in frame.columns)
            if names is None:
                names = observed
            elif names != observed:
                raise ValueError("eGeMAPS output schema changed between files")
        except (RuntimeError, OSError, ValueError):
            unreadable += 1
            rows.append(None)
            continue
        found += 1
        rows.append(values)
    if names is None:
        # eGeMAPS has a stable schema; obtain it from a zero signal if every path is unavailable.
        frame = extractor.process_signal(np.zeros(16000, dtype=np.float32), 16000)
        names = tuple(f"audio_egemaps_{name}" for name in frame.columns)
    matrix = np.zeros((len(paths), len(names)), dtype=np.float32)
    for index, values in enumerate(rows):
        if values is not None:
            matrix[index] = values
    return matrix, names, {"rows": len(paths), "found": found, "missing": missing, "unreadable": unreadable}


def _speech_flags(samples: np.ndarray, rate: int, vad: webrtcvad.Vad) -> list[bool]:
    if rate != 16000:
        samples = librosa.resample(samples, orig_sr=rate, target_sr=16000)
        rate = 16000
    pcm = np.clip(samples, -1.0, 1.0)
    pcm = (pcm * 32767).astype("<i2")
    frame = rate * 30 // 1000
    return [vad.is_speech(pcm[start : start + frame].tobytes(), rate) for start in range(0, len(pcm) - frame + 1, frame)]
