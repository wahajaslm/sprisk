import wave
from pathlib import Path

import numpy as np
import polars as pl
import pytest

from sprisk_clean.audio_assets import AUDIT_KIND, audit_audio, featurize_audio
from sprisk_clean.audio_speech import VAD_KIND, opensmile_features, voice_activity
from sprisk_clean.audio_models import diarize_audio, transcribe_audio
from sprisk_clean.synthesize_speech import synthesize_speech


def _wave(path: Path, value: int = 0) -> None:
    samples = np.full(800, value, dtype="<i2")
    with wave.open(str(path), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(8000)
        output.writeframes(samples.tobytes())


def test_audio_audit_and_features_are_row_aligned(tmp_path: Path) -> None:
    _wave(tmp_path / "silent.wav")
    _wave(tmp_path / "tone.wav", 12_000)
    (tmp_path / "broken.wav").write_bytes(b"not audio")
    rows = pl.DataFrame({"clip": ["silent.wav", "tone.wav", "broken.wav", "missing.wav"]})

    report = audit_audio(rows, str(tmp_path), "clip")[AUDIT_KIND]
    assert (report["found"], report["missing"], report["unreadable"], report["coverage"]) == (2, 1, 1, 0.5)
    assert report["duration_seconds"] == {"min": 0.1, "median": 0.1, "max": 0.1}
    assert report["sample_rates"] == {8000: 2}

    result = featurize_audio(rows.head(2), rows.tail(2), str(tmp_path), "clip")
    assert result["train_words"][0].shape == (2, 70)
    assert result["test_words"][0].shape == (2, 70)
    assert result["evidence"]["audio.feature_coverage"]["test"] == {
        "rows": 2, "found": 0, "missing": 1, "unreadable": 1,
    }


def test_opensmile_and_vad_report_only_audio_evidence(tmp_path: Path) -> None:
    _wave(tmp_path / "clip.wav", 12_000)
    rows = pl.DataFrame({"clip": ["clip.wav", "missing.wav"]})

    vad = voice_activity(rows, str(tmp_path), "clip")[VAD_KIND]
    assert (vad["found"], vad["missing"], vad["unreadable"], vad["frames"]) == (1, 1, 0, 3)

    result = opensmile_features(rows.head(1), rows.tail(1), str(tmp_path), "clip")
    assert result["train_words"][0].shape[0] == 1
    assert result["train_words"][0].shape[1] > 50
    assert result["test_words"][0].nnz == 0
    assert result["evidence"]["audio.opensmile_coverage"]["test"] == {
        "rows": 1, "found": 0, "missing": 1, "unreadable": 0,
    }


@pytest.mark.parametrize("operator", [transcribe_audio, diarize_audio])
def test_model_backed_audio_operators_require_an_explicit_local_model(
    tmp_path: Path, operator: object
) -> None:
    rows = pl.DataFrame({"clip": ["missing.wav"]})
    with pytest.raises(ValueError, match="model_dir is not a local directory"):
        operator(rows, str(tmp_path), "clip", str(tmp_path / "not-a-model"))  # type: ignore[operator]


def test_speech_synthesis_marks_outputs_synthetic(tmp_path: Path) -> None:
    result = synthesize_speech(
        pl.DataFrame({"text": ["", None]}), "text", str(tmp_path / "generated")
    )
    assert result["data"]["synthetic_audio"].to_list() == [True, True]
    assert result["data"]["synthetic_audio_path"].to_list() == [None, None]
    assert result["evidence"]["audio.synthetic_generation"]["generated"] == 0
