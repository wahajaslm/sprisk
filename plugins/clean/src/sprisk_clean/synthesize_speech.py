"""Explicit, local macOS speech synthesis; never an automatic profiling step."""

from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Any

import polars as pl


def synthesize_speech(
    data: pl.DataFrame,
    text_column: str,
    output_dir: str,
    output_path_column: str = "synthetic_audio_path",
    voice: str | None = None,
) -> dict[str, Any]:
    """Generate one labelled synthetic AIFF file per non-empty text row with macOS ``say``.

    Output is written only under the caller's declared directory. Source data is preserved and
    every generated path is explicitly marked synthetic, so it cannot be mistaken for an input
    recording or silently re-enter a profiling run.
    """
    if text_column not in data.columns:
        raise ValueError(f"{text_column!r} is not a column of the data")
    if output_path_column in data.columns:
        raise ValueError(f"{output_path_column!r} already exists")
    root = Path(output_dir).resolve()
    root.mkdir(parents=True, exist_ok=True)
    if not root.is_dir():
        raise ValueError(f"output_dir is not a directory: {output_dir}")
    paths: list[str | None] = []
    generated = empty = failed = 0
    for index, value in enumerate(data[text_column].to_list()):
        text = "" if value is None else str(value).strip()
        if not text:
            empty += 1
            paths.append(None)
            continue
        path = root / f"synthetic_{index:08d}.aiff"
        command = ["say", "--output-file", str(path)]
        if voice:
            command.extend(["--voice", voice])
        command.append(text)
        try:
            subprocess.run(command, check=True, capture_output=True, text=True, timeout=120)
        except (OSError, subprocess.SubprocessError):
            failed += 1
            paths.append(None)
            continue
        generated += 1
        paths.append(str(path.relative_to(root)))
    return {
        "data": data.with_columns(
            pl.Series(output_path_column, paths, dtype=pl.String),
            pl.lit(True).alias("synthetic_audio"),
        ),
        "evidence": {"audio.synthetic_generation": {
            "engine": "macos-say", "rows": data.height, "generated": generated,
            "empty_text": empty, "failed": failed, "output_dir": str(root),
            "restriction": "synthetic outputs are not source recordings and must not enter profiling by default",
        }},
    }
