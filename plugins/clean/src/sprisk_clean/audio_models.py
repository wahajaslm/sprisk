"""Explicitly local model-backed speech operators.

Neither operator downloads a model or submits audio to a service.  The caller supplies a local
model directory, making model provenance and consent part of the pipeline parameters.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import polars as pl

from .audio_assets import _path


def transcribe_audio(
    data: pl.DataFrame,
    audio_dir: str,
    audio_path_column: str,
    model_dir: str,
    transcript_column: str = "transcript",
    language: str | None = None,
) -> dict[str, Any]:
    """Add local faster-whisper transcripts; unavailable assets remain null, never invented."""
    root = _root(audio_dir, "audio_dir")
    model = _root(model_dir, "model_dir")
    if audio_path_column not in data.columns:
        raise ValueError(f"{audio_path_column!r} is not a column of the data")
    if transcript_column in data.columns:
        raise ValueError(f"{transcript_column!r} already exists; choose a new transcript column")
    from faster_whisper import WhisperModel

    recognizer = WhisperModel(str(model), device="cpu", compute_type="int8")
    transcripts: list[str | None] = []
    found = missing = failed = words = 0
    for raw in data[audio_path_column].to_list():
        path = _path(root, raw)
        if path is None or not path.is_file():
            missing += 1
            transcripts.append(None)
            continue
        try:
            segments, _ = recognizer.transcribe(str(path), language=language, vad_filter=True)
            text = " ".join(segment.text.strip() for segment in segments).strip()
        except (RuntimeError, OSError, ValueError):
            failed += 1
            transcripts.append(None)
            continue
        found += 1
        words += len(text.split())
        transcripts.append(text)
    return {
        "data": data.with_columns(pl.Series(transcript_column, transcripts, dtype=pl.String)),
        "evidence": {"audio.transcription_coverage": {
            "engine": "faster-whisper", "model_dir": str(model), "language": language,
            "rows": data.height, "transcribed": found, "missing": missing, "failed": failed,
            "transcript_words": words,
        }},
    }


def diarize_audio(
    data: pl.DataFrame,
    audio_dir: str,
    audio_path_column: str,
    model_dir: str,
) -> dict[str, Any]:
    """Add non-identifying local diarization summaries, never speaker names or biometrics."""
    root = _root(audio_dir, "audio_dir")
    model = _root(model_dir, "model_dir")
    if audio_path_column not in data.columns:
        raise ValueError(f"{audio_path_column!r} is not a column of the data")
    from pyannote.audio import Pipeline

    pipeline = Pipeline.from_pretrained(str(model))
    speakers: list[int | None] = []
    turns: list[int | None] = []
    seconds: list[float | None] = []
    found = missing = failed = 0
    for raw in data[audio_path_column].to_list():
        path = _path(root, raw)
        if path is None or not path.is_file():
            missing += 1
            speakers.append(None); turns.append(None); seconds.append(None)
            continue
        try:
            output = pipeline(str(path))
            annotation = getattr(output, "speaker_diarization", output)
            spans = list(annotation.itertracks(yield_label=True))
            labels = {label for _, _, label in spans}
            speakers.append(len(labels))
            turns.append(len(spans))
            seconds.append(float(sum(segment.end - segment.start for segment, _, _ in spans)))
        except (RuntimeError, OSError, ValueError, AttributeError):
            failed += 1
            speakers.append(None); turns.append(None); seconds.append(None)
            continue
        found += 1
    return {
        "data": data.with_columns(
            pl.Series("diarized_speaker_count", speakers, dtype=pl.Int64),
            pl.Series("diarized_turn_count", turns, dtype=pl.Int64),
            pl.Series("diarized_speech_seconds", seconds, dtype=pl.Float64),
        ),
        "evidence": {"audio.diarization_coverage": {
            "engine": "pyannote.audio", "model_dir": str(model), "rows": data.height,
            "diarized": found, "missing": missing, "failed": failed,
            "privacy": "non-identifying aggregate speaker and turn counts only",
        }},
    }


def _root(value: str, name: str) -> Path:
    path = Path(value).resolve()
    if not path.is_dir():
        raise ValueError(f"{name} is not a local directory: {value}")
    return path
