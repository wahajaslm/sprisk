"""Tiny audio and image files, and a tiny CLIP, for asset-step tests."""

import wave
from pathlib import Path
from typing import Any

import numpy as np
import torch
from PIL import Image
from transformers import CLIPConfig, CLIPImageProcessor, CLIPModel


def write_wave(path: Path, value: int = 0) -> None:
    with wave.open(str(path), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(8000)
        output.writeframes(np.full(800, value, dtype="<i2").tobytes())


def write_image(path: Path, colour: tuple[int, int, int]) -> None:
    Image.new("RGB", (40, 30), colour).save(path)


def tiny_clip() -> tuple[Any, Any]:
    """Stands in for the real weights, which are a download and a disk cache."""
    torch.manual_seed(0)
    layers = {
        "hidden_size": 16,
        "intermediate_size": 32,
        "num_hidden_layers": 1,
        "num_attention_heads": 2,
    }
    config = CLIPConfig(
        vision_config={**layers, "image_size": 32, "patch_size": 16},
        text_config={**layers, "vocab_size": 50},
        projection_dim=8,
    )
    processor = CLIPImageProcessor(
        size={"shortest_edge": 32}, crop_size={"height": 32, "width": 32}
    )
    model: Any = CLIPModel(config)
    return processor, model.eval()
