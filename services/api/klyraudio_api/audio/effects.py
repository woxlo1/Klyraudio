"""A small, deterministic effects chain implemented with NumPy.

The effects are intentionally transparent about their algorithms: EQ is an
FFT frequency-response filter, reverb is convolution with a synthetic impulse
response, and dynamics use a block-based envelope follower. This is not intended
to emulate a specific analog device.
"""

from __future__ import annotations

import numpy as np

from ..schemas import EffectSpec
from . import dsp


def _frequency_response(
    frequencies: np.ndarray,
    sample_rate: int,
    gains: dict[str, float],
) -> np.ndarray:
    response = np.ones_like(frequencies, dtype=np.float64)
    low_gain = dsp.db_to_linear(gains.get("low_gain_db", 0.0))
    mid_gain = dsp.db_to_linear(gains.get("mid_gain_db", 0.0))
    high_gain = dsp.db_to_linear(gains.get("high_gain_db", 0.0))
    low_cut = max(20.0, gains.get("low_freq", 200.0))
    high_cut = min(sample_rate / 2.0 - 1.0, gains.get("high_freq", 4000.0))
    mid_freq = max(20.0, gains.get("mid_freq", 1000.0))
    q = max(0.1, gains.get("mid_q", 1.0))

    safe = np.maximum(frequencies, 1e-6)
    low_weight = 1.0 / (1.0 + (safe / low_cut) ** 2)
    high_weight = 1.0 / (1.0 + (high_cut / safe) ** 2)
    bandwidth = max(20.0, mid_freq / q)
    mid_weight = np.exp(-0.5 * ((safe - mid_freq) / bandwidth) ** 2)

    response *= 1.0 + (low_gain - 1.0) * low_weight
    response *= 1.0 + (high_gain - 1.0) * high_weight
    response *= 1.0 + (mid_gain - 1.0) * mid_weight
    return response


def apply_eq(data: np.ndarray, sample_rate: int, params: dict[str, float]) -> np.ndarray:
    audio = dsp.as_2d(data)
    if audio.size == 0:
        return audio
    frames = audio.shape[0]
    spectrum = np.fft.rfft(audio, axis=0)
    frequencies = np.fft.rfftfreq(frames, d=1.0 / sample_rate)
    response = _frequency_response(frequencies, sample_rate, params)
    spectrum *= response[:, None]
    return np.fft.irfft(spectrum, n=frames, axis=0).astype(np.float32)


def apply_compressor(data: np.ndarray, sample_rate: int, params: dict[str, float]) -> np.ndarray:
    audio = dsp.as_2d(data)
    if audio.size == 0:
        return audio
    threshold_db = params.get("threshold_db", -18.0)
    ratio = max(1.0, params.get("ratio", 4.0))
    attack_ms = max(0.1, params.get("attack_ms", 10.0))
    release_ms = max(1.0, params.get("release_ms", 120.0))
    makeup_db = params.get("makeup_db", 0.0)
    block = 256
    frames = audio.shape[0]
    pad = (-frames) % block
    padded = np.pad(audio, ((0, pad), (0, 0)))
    blocks = padded.reshape(-1, block, audio.shape[1])
    block_rms = np.sqrt(np.mean(np.square(blocks, dtype=np.float64), axis=(1, 2)) + 1e-12)
    block_db = 20.0 * np.log10(block_rms)
    block_gain = np.ones_like(block_db)
    attack = np.exp(-block / (sample_rate * attack_ms / 1000.0))
    release = np.exp(-block / (sample_rate * release_ms / 1000.0))
    current = 1.0
    for index, level in enumerate(block_db):
        if level > threshold_db:
            reduction = (level - threshold_db) * (1.0 - 1.0 / ratio)
            target = dsp.db_to_linear(-reduction)
        else:
            target = 1.0
        coeff = attack if target < current else release
        current = coeff * current + (1.0 - coeff) * target
        block_gain[index] = current
    block_gain *= dsp.db_to_linear(makeup_db)
    gain_curve = np.repeat(block_gain, block)[:frames]
    gain_curve = np.interp(
        np.arange(frames),
        np.arange(0, frames, block),
        gain_curve[::block][: (frames + block - 1) // block],
    )
    return (audio * gain_curve[:, None]).astype(np.float32)


def apply_limiter(data: np.ndarray, sample_rate: int, params: dict[str, float]) -> np.ndarray:
    audio = dsp.as_2d(data)
    if audio.size == 0:
        return audio
    ceiling_db = params.get("ceiling_db", -0.3)
    ceiling = dsp.db_to_linear(ceiling_db)
    peaks = np.max(np.abs(audio), axis=1)
    if peaks.max() <= ceiling:
        return audio
    block = 128
    frames = audio.shape[0]
    envelope = np.maximum(
        np.maximum.reduceat(peaks, np.arange(0, frames, block)),
        1e-9,
    )
    gains = np.minimum(1.0, ceiling / envelope)
    smooth = np.copy(gains)
    release = 0.995
    for index in range(1, len(smooth)):
        smooth[index] = min(smooth[index], release * smooth[index - 1] + (1.0 - release))
    curve = np.repeat(smooth, block)[:frames]
    curve = np.interp(np.arange(frames), np.arange(0, frames, block), smooth)
    limited = audio * curve[:, None]
    return np.tanh(limited / ceiling * 1.02) * ceiling


def _impulse_response(
    sample_rate: int, decay_seconds: float, seed: int = 1337, predelay_ms: float = 20.0
) -> np.ndarray:
    frames = max(1, int(decay_seconds * sample_rate))
    generator = np.random.default_rng(seed)
    noise = generator.standard_normal((frames, 1)).astype(np.float32)
    envelope = np.exp(-np.linspace(0.0, 6.0, frames, dtype=np.float32))[:, None]
    ir = noise * envelope
    ir /= max(1e-6, float(np.sqrt(np.sum(ir**2))))
    predelay = int(sample_rate * predelay_ms / 1000.0)
    if predelay > 0:
        ir = np.vstack([np.zeros((predelay, 1), dtype=np.float32), ir])
    return ir


def apply_reverb(data: np.ndarray, sample_rate: int, params: dict[str, float]) -> np.ndarray:
    audio = dsp.as_2d(data)
    if audio.size == 0:
        return audio
    decay = float(np.clip(params.get("decay_seconds", 2.2), 0.1, 12.0))
    mix = float(np.clip(params.get("mix", 0.25), 0.0, 1.0))
    damp = float(np.clip(params.get("damping", 0.5), 0.0, 1.0))
    ir = _impulse_response(sample_rate, decay, seed=int(params.get("seed", 1337)))
    ir = ir.flatten()
    # One-pole low-pass damping on the impulse response.
    for _ in range(max(1, int(1 + damp * 4))):
        ir = np.convolve(ir, np.array([0.6, 0.4], dtype=np.float32), mode="same")
    wet_channels = []
    for channel in range(audio.shape[1]):
        length = audio.shape[0] + len(ir) - 1
        size = 1 << (length - 1).bit_length()
        wet = np.fft.irfft(
            np.fft.rfft(audio[:, channel], n=size) * np.fft.rfft(ir, n=size), n=size
        )[: audio.shape[0]]
        wet_channels.append(wet.astype(np.float32))
    wet = np.stack(wet_channels, axis=1)
    return ((1.0 - mix) * audio + mix * wet).astype(np.float32)


def apply_delay(data: np.ndarray, sample_rate: int, params: dict[str, float]) -> np.ndarray:
    audio = dsp.as_2d(data)
    if audio.size == 0:
        return audio
    delay_seconds = float(np.clip(params.get("delay_ms", 250.0) / 1000.0, 0.001, 4.0))
    feedback = float(np.clip(params.get("feedback", 0.3), 0.0, 0.95))
    mix = float(np.clip(params.get("mix", 0.25), 0.0, 1.0))
    taps = max(1, int(np.log(0.001) / np.log(max(feedback, 1e-3)))) if feedback > 0 else 1
    taps = min(taps, 64)
    delay_frames = max(1, int(delay_seconds * sample_rate))
    ir = np.zeros(delay_frames * taps + 1, dtype=np.float32)
    for index in range(taps):
        ir[(index + 1) * delay_frames] = feedback**index
    wet_channels = []
    for channel in range(audio.shape[1]):
        length = audio.shape[0] + len(ir) - 1
        size = 1 << (length - 1).bit_length()
        wet = np.fft.irfft(
            np.fft.rfft(audio[:, channel], n=size) * np.fft.rfft(ir, n=size), n=size
        )[: audio.shape[0]]
        wet_channels.append(wet.astype(np.float32))
    wet = np.stack(wet_channels, axis=1)
    return ((1.0 - mix) * audio + mix * wet).astype(np.float32)


def apply_chain(
    data: np.ndarray, sample_rate: int, effects: list[EffectSpec]
) -> np.ndarray:
    output = dsp.as_2d(data).copy()
    for effect in effects:
        if not effect.enabled:
            continue
        if effect.type == "eq":
            output = apply_eq(output, sample_rate, effect.params)
        elif effect.type == "compressor":
            output = apply_compressor(output, sample_rate, effect.params)
        elif effect.type == "limiter":
            output = apply_limiter(output, sample_rate, effect.params)
        elif effect.type == "reverb":
            output = apply_reverb(output, sample_rate, effect.params)
        elif effect.type == "delay":
            output = apply_delay(output, sample_rate, effect.params)
    return output


DEFAULT_EFFECTS: dict[str, dict[str, float]] = {
    "eq": {"low_gain_db": 0.0, "mid_gain_db": 0.0, "high_gain_db": 0.0},
    "compressor": {
        "threshold_db": -18.0,
        "ratio": 4.0,
        "attack_ms": 10.0,
        "release_ms": 120.0,
        "makeup_db": 0.0,
    },
    "limiter": {"ceiling_db": -0.3},
    "reverb": {"decay_seconds": 2.2, "mix": 0.25, "damping": 0.5},
    "delay": {"delay_ms": 250.0, "feedback": 0.3, "mix": 0.25},
}
