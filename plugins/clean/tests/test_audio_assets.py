import wave
from collections.abc import Callable
from pathlib import Path

import av
import numpy as np
import polars as pl
import pytest

from sprisk_clean.audio_assets import (
    AUDIO_FEATURE_NAMES,
    AUDIT_KIND,
    COPIES_KIND,
    audit_audio,
    drop_recording_copies,
    featurize_audio,
    read_audio,
    recording_copies,
)
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


def _m4a(path: Path, rate: int = 16_000, channels: int = 1) -> None:
    """Half a second of a 440 Hz tone in AAC, the format YouTube downloads arrive in."""
    tone = (0.5 * np.sin(2 * np.pi * 440 * np.arange(rate // 2) / rate)).astype(np.float32)
    layout = "mono" if channels == 1 else "stereo"
    with av.open(str(path), "w", format="mp4") as container:
        stream = container.add_stream("aac", rate=rate, layout=layout)
        planes = np.tile(tone, (channels, 1))
        frame = av.AudioFrame.from_ndarray(planes, format="fltp", layout=layout)
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


def _chord(path: Path, rate: int) -> None:
    """One second of 440 Hz plus a 6 kHz partial, stereo, written at the given rate."""
    t = np.arange(rate) / rate
    mono = 0.4 * np.sin(2 * np.pi * 440 * t) + 0.2 * np.sin(2 * np.pi * 6000 * t)
    with wave.open(str(path), "wb") as output:
        output.setnchannels(2)
        output.setsampwidth(2)
        output.setframerate(rate)
        output.writeframes((np.repeat(mono, 2) * 32_000).astype("<i2").tobytes())


@pytest.mark.parametrize("make", [_m4a, _chord])
def test_audio_is_read_at_the_rate_and_channels_a_step_asks_for(
    tmp_path: Path, make: Callable[..., None]
) -> None:
    # A step that analyses 22.05 kHz mono reads it so, whatever the file holds (44.1 kHz stereo).
    path = tmp_path / ("song.m4a" if make is _m4a else "song.wav")
    make(path, rate=44_100, **({"channels": 2} if make is _m4a else {}))

    samples, rate = read_audio(path, rate=22_050, mono=True)

    assert rate == 22_050
    assert samples.shape[1] == 1
    spectrum = np.abs(np.fft.rfft(samples[:, 0]))
    peak = np.fft.rfftfreq(len(samples), 1 / rate)[spectrum.argmax()]
    assert abs(peak - 440) < 5


def test_audio_features_do_not_depend_on_the_file_sample_rate(tmp_path: Path) -> None:
    # librosa frames are counted in samples, so the same sound at 44.1 kHz and 22.05 kHz gave
    # different statistics: tempo 139.7 vs 112.3 BPM for this chord. Features are now computed
    # at one rate, so the two rows match.
    _chord(tmp_path / "high.wav", 44_100)
    _chord(tmp_path / "low.wav", 22_050)
    _tone(tmp_path / "other.wav", 220, 0.8, rate=22_050)
    train = pl.DataFrame({"clip": ["high.wav", "low.wav", "other.wav"]})

    values = featurize_audio(train, train, str(tmp_path), "clip")["train_words"][0].toarray()

    for name in ("audio_tempo_bpm", "audio_spectral_centroid_hz_mean"):
        column = AUDIO_FEATURE_NAMES.index(name)
        assert values[0, column] == pytest.approx(values[1, column], abs=0.1)


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


def test_copies_of_one_recording_are_counted_and_dropped_keeping_the_first(
    tmp_path: Path,
) -> None:
    # b.wav is a.wav under another name, and a.wav is listed twice: three rows, one recording.
    _tone(tmp_path / "a.wav", 440, 0.5)
    (tmp_path / "b.wav").write_bytes((tmp_path / "a.wav").read_bytes())
    _tone(tmp_path / "c.wav", 880, 0.5)
    clips = ["a.wav", "b.wav", "a.wav", "c.wav", "missing.wav"]
    rows = pl.DataFrame({"clip": clips, "y": range(5)})

    found = recording_copies(rows, str(tmp_path), "clip")[COPIES_KIND]
    assert found == {
        "rows": 5, "hashed": 4, "missing": 1, "unreadable": 0,
        "copies": 2, "groups": 1, "largest_group": 3,
    }

    kept = drop_recording_copies(rows, str(tmp_path), "clip")["data"]
    # A row whose file cannot be read is kept: nothing shows it copies another.
    assert kept["clip"].to_list() == ["a.wav", "c.wav", "missing.wav"]


def test_librosa_features_decode_a_file_once_per_process(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Cross-validation runs the step once per fold: the raw features of a file are kept, and
    # only the scaling is refit on each fold's train rows.
    import sprisk_clean.audio_assets as module

    _tone(tmp_path / "a.wav", 440, 0.5)
    _tone(tmp_path / "b.wav", 880, 0.5)
    rows = pl.DataFrame({"clip": ["a.wav", "b.wav"]})
    module.clear_feature_cache()
    decoded: list[Path] = []
    original = module.read_audio

    def counting(path: Path, **kwargs: object) -> object:
        decoded.append(path)
        return original(path, **kwargs)  # type: ignore[arg-type]

    monkeypatch.setattr(module, "read_audio", counting)
    featurize_audio(rows, rows, str(tmp_path), "clip")
    featurize_audio(rows.head(1), rows.tail(1), str(tmp_path), "clip")
    assert len(decoded) == 2
