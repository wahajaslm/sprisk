"""Frozen audio embeddings: each recording becomes one vector from a pretrained encoder.

The encoder is never fitted on dataset rows. Its weights are a fixed, locally cached model,
loaded with ``local_files_only``, so running the step never downloads anything (rule 6). Each
encoder reads audio at the rate it was trained on: CLAP at 48 kHz, MERT at 24 kHz. Fed another
rate, its frames stop lining up with what it learned and the embedding is noise.

A song is longer than an encoder's input, so it is cut into evenly spaced windows; each window
is embedded and the windows are averaged. Example: a 4-minute song with 10 s windows and at
most 12 gives windows starting every ~20 s, the same ones on every run.
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import cache
from pathlib import Path
from typing import Any

import numpy as np
import polars as pl
import torch

from .audio_assets import _append, _path, _root, read_audio

KIND = "audio.embedding_coverage"


@dataclass(frozen=True)
class Encoder:
    repo: str
    rate: int
    dimensions: int
    # The weights' licence, carried into the evidence: MERT's weights are non-commercial, so a
    # result built on them cannot ship in a product.
    weights_license: str


ENCODERS: dict[str, Encoder] = {
    "clap": Encoder("laion/clap-htsat-unfused", 48_000, 512, "Apache-2.0"),
    "mert": Encoder("m-a-p/MERT-v1-95M", 24_000, 768, "CC-BY-NC-4.0"),
    # MERT with continued pretraining on Hindustani, Carnatic, Turkish makam and Greek music
    # (arXiv 2506.17818): same architecture and input as MERT.
    "culturemert": Encoder("ntua-slp/CultureMERT-95M", 24_000, 768, "CC-BY-NC-4.0"),
}
MERT_LAYERS = 12
# One embedding per file, encoder and window settings, kept for the life of the process: the
# encoder fits nothing, so cross-validation, which runs this step once per fold, embeds each
# file once. MERT keeps all 12 layers (shape (12, 768)), so choosing another layer is free.
# Example: 5 folds x 10 repeats over 120 songs decode 120 files, not 12,000.
_EMBEDDED: dict[tuple[object, ...], np.ndarray] = {}


def clear_cache() -> None:
    """Forget every kept embedding; the next call decodes and embeds again."""
    _EMBEDDED.clear()


def embed_audio(
    train: pl.DataFrame,
    test: pl.DataFrame,
    audio_dir: str,
    audio_path_column: str,
    encoder: str = "clap",
    layer: int | None = None,
    window_seconds: float = 10.0,
    max_windows: int = 12,
    train_words: tuple[Any, tuple[str, ...]] | None = None,
    test_words: tuple[Any, tuple[str, ...]] | None = None,
) -> dict[str, Any]:
    """Append one frozen embedding per row to optional word features.

    `layer` picks one of MERT's 12 encoder layers (1 to 12); left out, the layers are
    averaged. CLAP has one output, its projected audio embedding, scaled to unit length.
    Missing or unreadable files become zero rows and are counted in the evidence.
    """
    if encoder not in ENCODERS:
        raise ValueError(f"encoder must be one of {sorted(ENCODERS)}, not {encoder!r}")
    if layer is not None and encoder == "clap":
        raise ValueError("layer applies to MERT encoders only")
    if layer is not None and not 1 <= layer <= MERT_LAYERS:
        raise ValueError(f"layer must be 1 to {MERT_LAYERS}, not {layer}")
    spec = ENCODERS[encoder]
    root = _root(audio_dir, train, audio_path_column)
    _root(audio_dir, test, audio_path_column)
    embed = _clap(encoder) if encoder == "clap" else _mert(encoder)
    windows = (window_seconds, max_windows)
    train_paths = train[audio_path_column].to_list()
    test_paths = test[audio_path_column].to_list()
    pick = _layer_of(layer)
    train_values, train_state = _embed_rows(train_paths, root, encoder, embed, pick, windows)
    test_values, test_state = _embed_rows(test_paths, root, encoder, embed, pick, windows)
    names = tuple(f"audio_{encoder}_{i:03d}" for i in range(spec.dimensions))
    train_matrix, train_names = _append(train_values, names, train_words)
    test_matrix, test_names = _append(test_values, names, test_words)
    if train_names != test_names:
        raise ValueError("train and test audio embeddings differ")
    return {
        "train": train,
        "test": test,
        "train_words": (train_matrix, train_names),
        "test_words": (test_matrix, test_names),
        "evidence": {
            KIND: {
                "encoder": encoder,
                "model": spec.repo,
                "weights_license": spec.weights_license,
                "sample_rate": spec.rate,
                "dimensions": spec.dimensions,
                "layer": layer,
                "window_seconds": window_seconds,
                "max_windows": max_windows,
                "train": train_state,
                "test": test_state,
            }
        },
    }


def audio_windows(
    samples: np.ndarray, rate: int, seconds: float, max_windows: int
) -> list[np.ndarray]:
    """Up to `max_windows` windows of `seconds`, evenly spaced from the start to the end.

    A clip shorter than one window is one window. Example: 100 s, 10 s windows, at most 3:
    windows start at 0, 45 and 90 s.
    """
    size = int(seconds * rate)
    if len(samples) <= size:
        return [samples]
    count = min(max_windows, len(samples) // size)
    starts = np.linspace(0, len(samples) - size, count).round().astype(int)
    return [samples[start : start + size] for start in starts]


def is_cached(encoder: str) -> bool:
    """Whether the encoder's weights are in the local Hugging Face cache."""
    from huggingface_hub import snapshot_download
    from huggingface_hub.errors import LocalEntryNotFoundError

    try:
        snapshot_download(ENCODERS[encoder].repo, local_files_only=True)
    except LocalEntryNotFoundError:
        return False
    return True


def _embed_rows(
    paths: list[object],
    root: Path,
    encoder: str,
    embed: Any,
    pick: Any,
    windows: tuple[float, int],
) -> tuple[np.ndarray, dict[str, int]]:
    spec = ENCODERS[encoder]
    out = np.zeros((len(paths), spec.dimensions), dtype=np.float32)
    state = {"rows": len(paths), "found": 0, "missing": 0, "unreadable": 0}
    for row, raw in enumerate(paths):
        path = _path(root, raw)
        if path is None or not path.is_file():
            state["missing"] += 1
            continue
        stat = path.stat()
        key = (encoder, *windows, str(path), stat.st_size, stat.st_mtime_ns)
        if key not in _EMBEDDED:
            try:
                samples, _ = read_audio(path, rate=spec.rate, mono=True)
            except OSError:
                state["unreadable"] += 1
                continue
            _EMBEDDED[key] = embed(audio_windows(samples[:, 0], spec.rate, *windows))
        out[row] = pick(_EMBEDDED[key])
        state["found"] += 1
    return out, state


def _layer_of(layer: int | None) -> Any:
    """The row's vector from a kept embedding: CLAP's as it is, one MERT layer, or their mean."""

    def pick(kept: np.ndarray) -> np.ndarray:
        if kept.ndim == 1:
            return kept
        return kept.mean(axis=0) if layer is None else kept[layer - 1]

    return pick


@cache
def _clap(encoder: str) -> Any:
    from transformers import ClapModel, ClapProcessor

    spec = ENCODERS[encoder]
    processor = ClapProcessor.from_pretrained(spec.repo, local_files_only=True)
    loaded = ClapModel.from_pretrained(spec.repo, local_files_only=True)
    model = loaded.eval()  # type: ignore[no-untyped-call]

    def embed(chunks: list[np.ndarray]) -> np.ndarray:
        inputs = processor(audio=chunks, sampling_rate=spec.rate, return_tensors="pt")
        with torch.inference_mode():
            values = model.get_audio_features(**inputs)
            # Transformers 5 returns a model-output wrapper; older releases returned the tensor.
            if hasattr(values, "pooler_output"):
                values = values.pooler_output
            mean = values.mean(dim=0)
        return torch.nn.functional.normalize(mean, p=2, dim=0).cpu().numpy().astype(np.float32)

    return embed


@cache
def _mert(encoder: str) -> Any:
    from transformers import AutoModel, Wav2Vec2FeatureExtractor

    spec = ENCODERS[encoder]
    extractor = Wav2Vec2FeatureExtractor.from_pretrained(spec.repo, local_files_only=True)
    # MERT's model class ships as code in its cached snapshot; it runs from the local cache only.
    model = AutoModel.from_pretrained(
        spec.repo, local_files_only=True, trust_remote_code=True
    ).eval()
    # MERT's code ignores output_hidden_states under transformers 5 and returns None, so each
    # encoder layer's output is caught on the way through.
    caught: list[torch.Tensor] = []
    for block in model.encoder.layers:
        block.register_forward_hook(
            lambda _m, _i, out: caught.append(out[0] if isinstance(out, tuple) else out)
        )

    def embed(chunks: list[np.ndarray]) -> np.ndarray:
        """All 12 layers, each the mean over a window's frames, then over the windows."""
        per_window = []
        for chunk in chunks:
            inputs = extractor(chunk, sampling_rate=spec.rate, return_tensors="pt")
            caught.clear()
            with torch.inference_mode():
                model(**inputs)
            per_window.append(torch.stack([h[0].mean(dim=0) for h in caught]))
        return torch.stack(per_window).mean(dim=0).cpu().numpy().astype(np.float32)

    return embed
