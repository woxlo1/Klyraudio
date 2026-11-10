"""Core sample-domain editing operations."""

from __future__ import annotations

import numpy as np


def as_2d(data: np.ndarray) -> np.ndarray:
    array = np.asarray(data, dtype=np.float32)
    if array.ndim == 1:
        array = array[:, None]
    return array


def db_to_linear(db: float) -> float:
    return float(10.0 ** (db / 20.0))


def linear_to_db(value: float) -> float:
    return float(20.0 * np.log10(max(value, 1e-12)))


def peak(data: np.ndarray) -> float:
    if data.size == 0:
        return 0.0
    return float(np.max(np.abs(data)))


def rms(data: np.ndarray) -> float:
    if data.size == 0:
        return 0.0
    return float(np.sqrt(np.mean(np.square(data, dtype=np.float64))))


def normalize(data: np.ndarray, target_db: float = -1.0) -> np.ndarray:
    current = peak(data)
    if current <= 1e-9:
        return data.copy()
    target = db_to_linear(target_db)
    return (data * (target / current)).astype(np.float32)


def apply_gain(data: np.ndarray, gain_db: float) -> np.ndarray:
    return (as_2d(data) * db_to_linear(gain_db)).astype(np.float32)


def fade(data: np.ndarray, fade_in: float, fade_out: float, sample_rate: int) -> np.ndarray:
    output = as_2d(data).copy()
    frames = output.shape[0]
    fade_in_frames = min(frames, max(0, int(round(fade_in * sample_rate))))
    fade_out_frames = min(frames - fade_in_frames, max(0, int(round(fade_out * sample_rate))))
    if fade_in_frames > 0:
        curve = np.linspace(0.0, 1.0, fade_in_frames, dtype=np.float32) ** 2
        output[:fade_in_frames] *= curve[:, None]
    if fade_out_frames > 0:
        curve = np.linspace(1.0, 0.0, fade_out_frames, dtype=np.float32) ** 2
        output[-fade_out_frames:] *= curve[:, None]
    return output


def trim(data: np.ndarray, start: float, end: float, sample_rate: int) -> np.ndarray:
    frames = as_2d(data).shape[0]
    start_frame = min(frames, max(0, int(round(start * sample_rate))))
    end_frame = min(frames, max(start_frame, int(round(end * sample_rate))))
    return as_2d(data)[start_frame:end_frame].copy()


def silence(data: np.ndarray, start: float, end: float, sample_rate: int) -> np.ndarray:
    output = as_2d(data).copy()
    frames = output.shape[0]
    start_frame = min(frames, max(0, int(round(start * sample_rate))))
    end_frame = min(frames, max(start_frame, int(round(end * sample_rate))))
    output[start_frame:end_frame] = 0.0
    return output


def reverse(data: np.ndarray) -> np.ndarray:
    return as_2d(data)[::-1].copy()


def ensure_length(data: np.ndarray, frames: int) -> np.ndarray:
    output = as_2d(data)
    if output.shape[0] >= frames:
        return output[:frames].copy()
    pad = np.zeros((frames - output.shape[0], output.shape[1]), dtype=np.float32)
    return np.vstack([output, pad])


def equal_power_crossfade(
    first: np.ndarray, second: np.ndarray, crossfade_seconds: float, sample_rate: int
) -> np.ndarray:
    """Join two signals with an equal-power crossfade; returns the joined signal."""
    a = as_2d(first)
    b = as_2d(second)
    channels = max(a.shape[1], b.shape[1])
    if a.shape[1] < channels:
        a = np.repeat(a, channels, axis=1)
    if b.shape[1] < channels:
        b = np.repeat(b, channels, axis=1)
    frames = min(int(round(crossfade_seconds * sample_rate)), a.shape[0], b.shape[0])
    if frames <= 1:
        return np.vstack([a, b])
    t = np.linspace(0.0, np.pi / 2.0, frames, dtype=np.float32)
    fade_out = np.cos(t)[:, None]
    fade_in = np.sin(t)[:, None]
    overlap = a[-frames:] * fade_out + b[:frames] * fade_in
    return np.vstack([a[:-frames], overlap, b[frames:]])


def make_loop(data: np.ndarray, crossfade_seconds: float, sample_rate: int) -> np.ndarray:
    """Create a seamless loop by folding the tail into the head with an equal-power fade."""
    audio = as_2d(data).copy()
    frames = min(int(round(crossfade_seconds * sample_rate)), audio.shape[0] // 2)
    if frames <= 1:
        return audio
    head = audio[:frames]
    tail = audio[-frames:]
    t = np.linspace(0.0, np.pi / 2.0, frames, dtype=np.float32)
    blended = tail * np.cos(t)[:, None] + head * np.sin(t)[:, None]
    return np.vstack([blended, audio[frames:-frames]]).astype(np.float32)


def join(parts: list[np.ndarray], crossfade_seconds: float, sample_rate: int) -> np.ndarray:
    if not parts:
        return np.zeros((0, 1), dtype=np.float32)
    output = as_2d(parts[0])
    for part in parts[1:]:
        output = equal_power_crossfade(output, part, crossfade_seconds, sample_rate)
    return output.astype(np.float32)


def pad_to(data: np.ndarray, frames: int) -> np.ndarray:
    output = as_2d(data)
    if output.shape[0] >= frames:
        return output[:frames]
    padding = np.zeros((frames - output.shape[0], output.shape[1]), dtype=np.float32)
    return np.vstack([output, padding])


def mix_at(
    target: np.ndarray,
    source: np.ndarray,
    start_frame: int,
    gain: float = 1.0,
    pan: float = 0.0,
) -> None:
    """Mix ``source`` into ``target`` in place with constant-power panning."""
    if start_frame >= target.shape[0]:
        return
    frames = min(source.shape[0], target.shape[0] - start_frame)
    if frames <= 0:
        return
    src = as_2d(source[:frames])
    channels = target.shape[1]
    if src.shape[1] == 1 and channels == 2:
        angle = (float(np.clip(pan, -1.0, 1.0)) + 1.0) * np.pi / 4.0
        src = np.repeat(src, 2, axis=1)
        src[:, 0] *= np.cos(angle) * np.sqrt(2.0)
        src[:, 1] *= np.sin(angle) * np.sqrt(2.0)
    elif src.shape[1] == 2 and channels == 1:
        src = src.mean(axis=1, keepdims=True)
    elif src.shape[1] < channels:
        src = np.repeat(src, channels, axis=1)
    elif src.shape[1] > channels:
        src = src[:, :channels]
    target[start_frame : start_frame + frames] += src * gain
