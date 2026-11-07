import wave
from pathlib import Path

import av
import numpy as np
import polars as pl
import pytest

from sprisk_clean.audio_assets import AUDIO_FEATURE_NAMES, AUDIT_KIND, audit_audio, featurize_audio
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


def _m4a(path: Path, rate: int = 16_000) -> None:
    """Half a second of a 440 Hz tone in AAC, the format YouTube downloads arrive in."""
    tone = (0.5 * np.sin(2 * np.pi * 440 * np.arange(rate // 2) / rate)).astype(np.float32)
    with av.open(str(path), "w", format="mp4") as container:
        stream = container.add_stream("aac", rate=rate, layout="mono")
        frame = av.AudioFrame.from_ndarray(tone.reshape(1, -1), format="flt", layout="mono")
        frame.sample_rate = rate
        for packet in [*stream.encode(frame), *stream.encode(None)]:
            container.mux(packet)


def _tone(path: Path, frequency: float, amplitude: float, rate: int = 8000) -> None:
    wave_ = amplitude * 32_000 * np.sin(2 * np.pi * frequency * np.arange(rate) / rate)
    samples = wave_.astype("<i2")
    with wave.open(str(path), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(rate)
        output.writeframes(samples.tobytes())


def test_compressed_audio_that_soundfile_cannot_read_is_decoded(tmp_path: Path) -> None:
    _m4a(tmp_path / "song.m4a")
    rows = pl.DataFrame({"clip": ["song.m4a"]})

    report = audit_audio(rows, str(tmp_path), "clip")[AUDIT_KIND]
    assert (report["found"], report["unreadable"]) == (1, 0)
    assert report["sample_rates"] == {16_000: 1}

    result = featurize_audio(rows, rows, str(tmp_path), "clip")
    assert result["evidence"]["audio.feature_coverage"]["train"]["found"] == 1
    assert voice_activity(rows, str(tmp_path), "clip")[VAD_KIND]["found"] == 1
    smile = opensmile_features(rows, rows, str(tmp_path), "clip")["evidence"]
    assert smile["audio.opensmile_coverage"]["train"]["found"] == 1


def test_audio_features_are_scaled_with_train_rows_only(tmp_path: Path) -> None:
    # Raw descriptors span very different ranges (tempo near 120, flatness near 0.01), which
    # stalls a linear model. Each column is centred and scaled by the train rows' mean and spread.
    tones = [("a", 220, 0.2), ("b", 440, 0.5), ("c", 880, 0.8), ("t", 3000, 0.9)]
    for name, frequency, amplitude in tones:
        _tone(tmp_path / f"{name}.wav", frequency, amplitude)
    train = pl.DataFrame({"clip": ["a.wav", "b.wav", "c.wav"]})
    test = pl.DataFrame({"clip": ["t.wav", "missing.wav"]})

    result = featurize_audio(train, test, str(tmp_path), "clip")
    values = result["train_words"][0].toarray()
    varying = values.std(axis=0) > 0
    assert np.allclose(values.mean(axis=0), 0, atol=1e-5)
    assert np.allclose(values.std(axis=0)[varying], 1, atol=1e-4)
    # A missing file sits at the train mean, and the test tone is scaled by train moments,
    # so its high pitch lands far outside the train range.
    test_values = result["test_words"][0].toarray()
    assert np.allclose(test_values[1], 0)
    centroid = AUDIO_FEATURE_NAMES.index("audio_spectral_centroid_hz_mean")
    assert test_values[0, centroid] > values[:, centroid].max()
    # Other test files leave the train features unchanged: nothing is learned from test rows.
    other = featurize_audio(train, pl.DataFrame({"clip": ["a.wav"]}), str(tmp_path), "clip")
    assert np.array_equal(other["train_words"][0].toarray(), values)


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
