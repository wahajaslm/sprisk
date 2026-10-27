from pathlib import Path

import polars as pl
from asset_files import write_wave

from sprisk_clean.audio_assets import AUDIT_KIND, audit_audio, featurize_audio
from sprisk_clean.audio_speech import VAD_KIND, opensmile_features, voice_activity


def test_audio_audit_and_features_are_row_aligned(tmp_path: Path) -> None:
    write_wave(tmp_path / "silent.wav")
    write_wave(tmp_path / "tone.wav", 12_000)
    (tmp_path / "broken.wav").write_bytes(b"not audio")
    rows = pl.DataFrame({"clip": ["silent.wav", "tone.wav", "broken.wav", "missing.wav"]})

    report = audit_audio(rows, tmp_path, "clip")[AUDIT_KIND]
    assert (report["found"], report["missing"], report["unreadable"], report["coverage"]) == (
        2,
        1,
        1,
        0.5,
    )
    assert report["duration_seconds"] == {"min": 0.1, "median": 0.1, "max": 0.1}
    assert report["sample_rates"] == {8000: 2}

    result = featurize_audio(rows.head(2), rows.tail(2), tmp_path, "clip")
    assert result["train_words"][0].shape == (2, 70)
    assert result["test_words"][0].shape == (2, 70)
    assert result["evidence"]["audio.feature_coverage"]["test"] == {
        "rows": 2,
        "found": 0,
        "missing": 1,
        "unreadable": 1,
    }


def test_opensmile_and_vad_report_only_audio_evidence(tmp_path: Path) -> None:
    write_wave(tmp_path / "clip.wav", 12_000)
    rows = pl.DataFrame({"clip": ["clip.wav", "missing.wav"]})

    vad = voice_activity(rows, tmp_path, "clip")[VAD_KIND]
    assert (vad["found"], vad["missing"], vad["unreadable"], vad["frames"]) == (1, 1, 0, 3)

    result = opensmile_features(rows.head(1), rows.tail(1), tmp_path, "clip")
    assert result["train_words"][0].shape[0] == 1
    assert result["train_words"][0].shape[1] > 50
    assert result["test_words"][0].nnz == 0
    assert result["evidence"]["audio.opensmile_coverage"]["test"] == {
        "rows": 1,
        "found": 0,
        "missing": 1,
        "unreadable": 0,
    }
