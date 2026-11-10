"""Waveform peak extraction with a small on-disk cache."""

from __future__ import annotations

import json
from pathlib import Path
from typing import List

import numpy as np

from .io import load


def compute_peaks(path: Path, points: int, cache_dir: Path, ffmpeg: str | None = None) -> List[List[float]]:
    points = max(64, min(int(points), 4000))
    cache_dir.mkdir(parents=True, exist_ok=True)
    cache_file = cache_dir / f"{path.stem}-{path.stat().st_mtime_ns}-{points}.json"
    if cache_file.exists():
        try:
            cached = json.loads(cache_file.read_text(encoding="utf-8"))
            if isinstance(cached, list) and len(cached) > 0:
                return cached
        except (OSError, ValueError):
            pass

    data = load(path, ffmpeg=ffmpeg)
    frames, channels = data.shape
    peaks: List[List[float]] = []
    if frames == 0:
        return [[0.0, 0.0] for _ in range(channels)]
    edges = np.linspace(0, frames, points + 1, dtype=np.int64)
    for channel in range(channels):
        signal = data[:, channel]
        values: List[float] = []
        for index in range(points):
            segment = signal[edges[index] : edges[index + 1]]
            if segment.size == 0:
                values.extend([0.0, 0.0])
            else:
                values.extend([float(np.min(segment)), float(np.max(segment))])
        peaks.append(values)
    try:
        cache_file.write_text(json.dumps(peaks, separators=(",", ":")), encoding="utf-8")
    except OSError:
        pass
    return peaks
