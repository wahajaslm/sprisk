"""Frozen audio encoders turn each recording into one embedding, read at the rate the encoder
was trained on (ADR-0066)."""

import wave
from pathlib import Path

import numpy as np
import polars as pl
import pytest

from sprisk_clean.embed_audio import ENCODERS, audio_windows, embed_audio, is_cached


def _tone(path: Path, frequency: float, seconds: float = 3.0, rate: int = 44_100) -> None:
    t = np.arange(int(seconds * rate)) / rate
    samples = (0.5 * 32_000 * np.sin(2 * np.pi * frequency * t)).astype("<i2")
    with wave.open(str(path), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(rate)
        output.writeframes(samples.tobytes())


def test_windows_are_evenly_spaced_and_the_same_every_time() -> None:
    # 100 s at 10 Hz, 10 s windows, at most 3: starts at 0, 45 and 90 s, never a random crop.
    samples = np.arange(1000, dtype=np.float32)
    windows = audio_windows(samples, rate=10, seconds=10, max_windows=3)
    assert [int(w[0]) for w in windows] == [0, 450, 900]
    assert all(len(w) == 100 for w in windows)
    assert [int(w[0]) for w in audio_windows(samples, 10, 10, 3)] == [0, 450, 900]


def test_a_clip_shorter_than_a_window_is_one_window() -> None:
    windows = audio_windows(np.ones(40, dtype=np.float32), rate=10, seconds=10, max_windows=3)
    assert [len(w) for w in windows] == [40]


def test_each_encoder_reads_its_native_rate() -> None:
    assert ENCODERS["clap"].rate == 48_000
    assert ENCODERS["mert"].rate == 24_000
    assert ENCODERS["culturemert"].rate == 24_000


def test_an_unknown_encoder_is_refused(tmp_path: Path) -> None:
    rows = pl.DataFrame({"clip": ["a.wav"]})
    with pytest.raises(ValueError, match="encoder must be one of"):
        embed_audio(rows, rows, str(tmp_path), "clip", encoder="wav2vec")


def test_a_layer_mert_does_not_have_is_refused(tmp_path: Path) -> None:
    rows = pl.DataFrame({"clip": ["a.wav"]})
    with pytest.raises(ValueError, match="layer must be 1 to 12"):
        embed_audio(rows, rows, str(tmp_path), "clip", encoder="mert", layer=13)


@pytest.mark.skipif(not is_cached("clap"), reason="CLAP weights are not in the local cache")
def test_clap_gives_one_unit_vector_per_recording_and_zeros_for_a_missing_file(
    tmp_path: Path,
) -> None:
    _tone(tmp_path / "a.wav", 440)
    _tone(tmp_path / "b.wav", 880)
    train = pl.DataFrame({"clip": ["a.wav", "b.wav"]})
    test = pl.DataFrame({"clip": ["missing.wav"]})

    result = embed_audio(train, test, str(tmp_path), "clip", encoder="clap")

    values = result["train_words"][0].toarray()
    assert values.shape == (2, 512)
    assert np.allclose(np.linalg.norm(values, axis=1), 1, atol=1e-4)
    assert not np.allclose(values[0], values[1])
    assert np.allclose(result["test_words"][0].toarray(), 0)
    evidence = result["evidence"]["audio.embedding_coverage"]
    assert (evidence["encoder"], evidence["sample_rate"]) == ("clap", 48_000)
    assert evidence["weights_license"] == "Apache-2.0"
    assert evidence["test"] == {"rows": 1, "found": 0, "missing": 1, "unreadable": 0}
    again = embed_audio(train, test, str(tmp_path), "clip", encoder="clap")
    assert np.allclose(again["train_words"][0].toarray(), values)


@pytest.mark.skipif(not is_cached("mert"), reason="MERT weights are not in the local cache")
def test_mert_gives_768_values_from_one_chosen_layer(tmp_path: Path) -> None:
    _tone(tmp_path / "a.wav", 440)
    rows = pl.DataFrame({"clip": ["a.wav"]})

    every = embed_audio(rows, rows, str(tmp_path), "clip", encoder="mert")
    seventh = embed_audio(rows, rows, str(tmp_path), "clip", encoder="mert", layer=7)

    assert every["train_words"][0].shape == (1, 768)
    assert not np.allclose(every["train_words"][0].toarray(), seventh["train_words"][0].toarray())
    evidence = seventh["evidence"]["audio.embedding_coverage"]
    assert (evidence["layer"], evidence["weights_license"]) == (7, "CC-BY-NC-4.0")
