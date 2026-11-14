"""Klyraudio Sketch: the built-in, dependency-free procedural audio engine.

This engine is a real DSP synthesizer, not an AI model. It is clearly labeled as
non-AI in the UI and model registry. It provides immediate, fully local sound
generation on any CPU so that Klyraudio is usable before a user chooses to
install a large neural model.

Everything is deterministic for a given seed and prompt.
"""

from __future__ import annotations

import hashlib
import math
from collections.abc import Callable

import numpy as np

from ..audio import dsp, effects
from ..schemas import EffectSpec, GenerationRequest

ProgressCallback = Callable[[float, str], None]

SAMPLE_RATE = 44100
NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
MINOR_WORDS = {
    "sad", "dark", "melancholy", "minor", "horror", "tense", "mysterious", "noir",
     "悲しい", "暗い", "マイナー", "不気味",
}
CALM_WORDS = {
    "calm", "ambient", "relax", "soft", "gentle", "lofi", "sleep", "meditation",
     "穏やか", "静か", "リラックス", "環境音",
}
ENERGETIC_WORDS = {
    "energetic", "fast", "dance", "driving", "rock", "action", "epic", "upbeat",
     "元気", "速い", "ダンス", "激しい",
}


def _seed_from_request(request: GenerationRequest, variation: int) -> int:
    if request.seed is not None:
        return (request.seed + variation * 7919) & 0xFFFFFFFF
    digest = hashlib.sha256(f"{request.prompt}|{request.task}|{variation}".encode()).digest()
    return int.from_bytes(digest[:4], "big")


def _note_to_midi(name: str, default: int = 57) -> int:
    text = name.strip().upper().replace("M", "")
    if not text:
        return default
    note = text[:-1]
    octave_text = text[-1]
    if note not in NOTE_NAMES or not octave_text.isdigit():
        return default
    return NOTE_NAMES.index(note) + (int(octave_text) + 1) * 12


def _midi_to_freq(note: float) -> float:
    return float(440.0 * 2.0 ** ((note - 69.0) / 12.0))


def _adsr(length: int, attack: float, decay: float, sustain: float, release: float) -> np.ndarray:
    attack_frames = max(1, int(attack * SAMPLE_RATE))
    decay_frames = max(1, int(decay * SAMPLE_RATE))
    release_frames = max(1, int(release * SAMPLE_RATE))
    if attack_frames + decay_frames + release_frames > length:
        scale = length / (attack_frames + decay_frames + release_frames)
        attack_frames = max(1, int(attack_frames * scale))
        decay_frames = max(1, int(decay_frames * scale))
        release_frames = max(1, int(release_frames * scale))
    sustain_frames = max(0, length - attack_frames - decay_frames - release_frames)
    envelope = np.concatenate(
        [
            np.linspace(0.0, 1.0, attack_frames, dtype=np.float32),
            np.linspace(1.0, sustain, decay_frames, dtype=np.float32),
            np.full(sustain_frames, sustain, dtype=np.float32),
            np.linspace(sustain, 0.0, release_frames, dtype=np.float32),
        ]
    )
    if envelope.size < length:
        envelope = np.pad(envelope, (0, length - envelope.size))
    return envelope[:length]


def _oscillator(freq: np.ndarray, length: int, kind: str = "sine", phase: float = 0.0) -> np.ndarray:
    if np.isscalar(freq):
        f = np.full(length, float(freq), dtype=np.float32)
    else:
        f = np.asarray(freq, dtype=np.float32)
        if f.size < length:
            f = np.pad(f, (0, length - f.size), mode="edge")
        f = f[:length]
    phase_acc = 2.0 * np.pi * np.cumsum(f) / SAMPLE_RATE + phase
    if kind == "sine":
        return np.sin(phase_acc).astype(np.float32)
    if kind == "triangle":
        return (2.0 / np.pi * np.arcsin(np.sin(phase_acc))).astype(np.float32)
    if kind == "saw":
        return (2.0 * (phase_acc / (2.0 * np.pi) % 1.0) - 1.0).astype(np.float32)
    return np.sin(phase_acc).astype(np.float32)


def _lowpass(signal: np.ndarray, cutoff: float, order: int = 2) -> np.ndarray:
    """Zero-phase frequency-domain low-pass with a smooth Butterworth-like rolloff."""
    source = np.asarray(signal, dtype=np.float32)
    if source.size == 0:
        return source
    size = 1 << (source.size - 1).bit_length()
    spectrum = np.fft.rfft(source, n=size)
    frequencies = np.fft.rfftfreq(size, 1.0 / SAMPLE_RATE)
    response = 1.0 / np.sqrt(1.0 + (frequencies / max(1.0, cutoff)) ** (2 * order))
    filtered = np.fft.irfft(spectrum * response, n=size)[: source.size]
    return filtered.astype(np.float32)


def _highpass(signal: np.ndarray, cutoff: float, order: int = 2) -> np.ndarray:
    source = np.asarray(signal, dtype=np.float32)
    if source.size == 0:
        return source
    size = 1 << (source.size - 1).bit_length()
    spectrum = np.fft.rfft(source, n=size)
    frequencies = np.fft.rfftfreq(size, 1.0 / SAMPLE_RATE)
    ratio = (frequencies / max(1.0, cutoff)) ** (2 * order)
    response = np.sqrt(ratio / (1.0 + ratio))
    filtered = np.fft.irfft(spectrum * response, n=size)[: source.size]
    return filtered.astype(np.float32)


def _pink_noise(frames: int, rng: np.random.Generator) -> np.ndarray:
    white = rng.standard_normal(frames).astype(np.float32)
    spectrum = np.fft.rfft(white)
    frequencies = np.fft.rfftfreq(frames, 1.0 / SAMPLE_RATE)
    scale = 1.0 / np.sqrt(np.maximum(frequencies, 1.0))
    spectrum *= scale
    pink = np.fft.irfft(spectrum, n=frames).astype(np.float32)
    return pink / max(1e-6, float(np.max(np.abs(pink))))


def _place(target: np.ndarray, sample: np.ndarray, start: int, gain: float, pan: float = 0.0) -> None:
    dsp.mix_at(target, sample, max(0, start), gain, pan)


def _pad(data: np.ndarray, frames: int) -> np.ndarray:
    if data.shape[0] >= frames:
        return data[:frames]
    return np.vstack([data, np.zeros((frames - data.shape[0], data.shape[1]), dtype=np.float32)])


def _music(request: GenerationRequest, rng: np.random.Generator) -> np.ndarray:
    frames = int(request.duration * SAMPLE_RATE)
    prompt = request.prompt.lower()
    style = (request.params.style or "").lower()
    mood = (request.params.mood or "").lower()
    text = f"{prompt} {style} {mood}"
    minor = any(word in text for word in MINOR_WORDS)
    calm = any(word in text for word in CALM_WORDS) or request.task == "ambient"
    energetic = any(word in text for word in ENERGETIC_WORDS)

    bpm = request.params.tempo
    if not bpm:
        bpm = 70 if calm else 96
        if energetic:
            bpm = 124
    beat = 60.0 / max(30, min(300, bpm))
    bar_frames = int(beat * 4 * SAMPLE_RATE)
    chords = [0, 8, 3, 10] if minor else [0, 7, 5, 9]
    if calm:
        chords = [0, 5, 8, 7]
    root = _note_to_midi(request.params.musical_key or ("A3" if minor else "C3"))
    mix = np.zeros((frames, 2), dtype=np.float32)

    pad_gain = 0.20 if calm else 0.13
    arp_gain = 0.10 if calm else 0.15
    bass_gain = 0.20 if calm else 0.24
    drum_gain = 0.0 if calm else 0.30

    bar_count = max(1, math.ceil(frames / bar_frames))
    for bar in range(bar_count):
        start = bar * bar_frames
        if start >= frames:
            break
        degree = chords[bar % len(chords)]
        triad = [0, 3 if minor else 4, 7]

        # Pad: three detuned triangle voices, sustained across the bar.
        for interval in triad:
            midi = root + 12 + degree + interval
            length = min(bar_frames, frames - start)
            if length <= 0:
                continue
            env = _adsr(length, 0.25 if calm else 0.08, 0.2, 0.7, 0.35)
            freq = _midi_to_freq(midi)
            left = _oscillator(np.array([freq * 0.999, freq * 1.001]), length, "triangle")
            right = _oscillator(np.array([freq * 1.001, freq * 0.999]), length, "triangle")
            wave = np.stack([left, right], axis=1) * env[:, None]
            _place(mix, wave, start, pad_gain / len(triad))

        # Bass: root on beats 1 and 3 with a sub-octave.
        if start < frames:
            length = min(int(beat * 1.8 * SAMPLE_RATE), frames - start)
            env = _adsr(length, 0.01, 0.15, 0.55, 0.25)
            bass = _oscillator(_midi_to_freq(root - 12 + degree), length, "sine")
            _place(mix, (bass * env)[:, None], start, bass_gain, 0.0)
            if not calm:
                _place(
                    mix,
                    (bass * env)[:, None],
                    start + int(beat * 2 * SAMPLE_RATE),
                    bass_gain,
                    0.0,
                )

        # Arpeggio: eighth or sixteenth notes.
        subdivision = 2 if calm else 4
        step = int((beat / subdivision) * SAMPLE_RATE)
        pattern = [0, 1, 2, 1, 2, 0, 1, 2]
        for step_index in range(int(bar_frames / max(1, step))):
            note_start = start + step_index * step
            if note_start >= frames:
                break
            length = min(int(step * 1.4), frames - note_start)
            if length <= 0:
                continue
            interval = triad[pattern[step_index % len(pattern)]]
            midi = root + 24 + degree + interval + (12 if step_index % 8 == 6 else 0)
            env = _adsr(length, 0.005, 0.12, 0.15, 0.18)
            tone = _oscillator(_midi_to_freq(midi), length, "sine" if calm else "triangle")
            pan = math.sin(step_index * 0.8) * 0.35
            _place(mix, (tone * env)[:, None], note_start, arp_gain, pan)

        # Drums: simple synthesized kit.
        if drum_gain > 0:
            for beat_index in range(4):
                hit_start = start + int(beat_index * beat * SAMPLE_RATE)
                if hit_start >= frames:
                    continue
                if beat_index in (0, 2):
                    length = min(int(0.28 * SAMPLE_RATE), frames - hit_start)
                    t = np.arange(length, dtype=np.float32) / SAMPLE_RATE
                    sweep = 110.0 * np.exp(-t * 26.0) + 42.0
                    kick = np.sin(2 * np.pi * np.cumsum(sweep) / SAMPLE_RATE)
                    kick *= np.exp(-t * 10.0)
                    _place(mix, (kick * 0.9)[:, None], hit_start, drum_gain)
                if beat_index in (1, 3):
                    length = min(int(0.18 * SAMPLE_RATE), frames - hit_start)
                    noise = rng.standard_normal(length).astype(np.float32)
                    noise = _highpass(noise, 1200.0)
                    noise *= np.exp(-np.arange(length) / (SAMPLE_RATE * 0.045))
                    _place(mix, (noise * 0.55)[:, None], hit_start, drum_gain, 0.05)
            # Hats on every half beat.
            hat_step = int(beat / 2 * SAMPLE_RATE)
            for hat_index in range(int(bar_frames / max(1, hat_step))):
                hat_start = start + hat_index * hat_step
                if hat_start >= frames:
                    break
                length = min(int(0.05 * SAMPLE_RATE), frames - hat_start)
                noise = rng.standard_normal(length).astype(np.float32)
                noise = _highpass(noise, 6000.0)
                noise *= np.exp(-np.arange(length) / (SAMPLE_RATE * 0.012))
                _place(mix, (noise * 0.18)[:, None], hat_start, drum_gain, -0.25)

    mix *= 0.8
    if request.params.loop:
        mix = dsp.make_loop(mix, 1.5, SAMPLE_RATE)
    chain: list[EffectSpec] = []
    if not calm:
        chain.append(EffectSpec(type="compressor", params=effects.DEFAULT_EFFECTS["compressor"]))
    chain.append(EffectSpec(type="reverb", params={**effects.DEFAULT_EFFECTS["reverb"], "mix": 0.18}))
    chain.append(EffectSpec(type="limiter", params=effects.DEFAULT_EFFECTS["limiter"]))
    mix = effects.apply_chain(mix, SAMPLE_RATE, chain)
    return dsp.normalize(_pad(mix, frames), -1.0)


def _sfx(request: GenerationRequest, rng: np.random.Generator) -> np.ndarray:
    frames = int(request.duration * SAMPLE_RATE)
    text = f"{request.prompt} {request.params.style or ''}".lower()
    mix = np.zeros((frames, 2), dtype=np.float32)

    def noise_burst(duration: float, cutoff: float, decay: float, gain: float, pan: float = 0.0) -> None:
        length = max(1, min(int(duration * SAMPLE_RATE), frames))
        noise = rng.standard_normal(length).astype(np.float32)
        if cutoff > 1000:
            noise = _highpass(noise, cutoff * 0.3)
        else:
            noise = _lowpass(noise, max(80.0, cutoff))
        noise *= np.exp(-np.arange(length) / (SAMPLE_RATE * decay))
        _place(mix, (noise * gain)[:, None], 0, 1.0, pan)

    def tone_sweep(start_freq: float, end_freq: float, duration: float, gain: float, kind: str, pan: float = 0.0) -> None:
        length = max(1, min(int(duration * SAMPLE_RATE), frames))
        sweep = np.geomspace(max(20.0, start_freq), max(20.0, end_freq), length).astype(np.float32)
        env = _adsr(length, 0.005, 0.2, 0.3, 0.4)
        wave = _oscillator(sweep, length, kind) * env
        _place(mix, (wave * gain)[:, None], 0, 1.0, pan)

    impact_words = {"impact", "explosion", "hit", "punch", "thunder", "爆破", "衝撃", "打撃"}
    whoosh_words = {"whoosh", "swoosh", "transition", "sweep", "wind", "シュッ", "風切り", "遷移"}
    magic_words = {"magic", "spell", "sparkle", "fairy", "fantasy", "魔法", "キラキラ", "幻想的"}
    ui_words = {"click", "ui", "button", "notification", "beep", "クリック", "通知", "操作音"}
    water_words = {"water", "rain", "splash", "bubble", "水", "雨", "水滴"}
    mech_words = {"mechanical", "machine", "robot", "servo", "engine", "機械", "ロボット"}
    creature_words = {"creature", "monster", "animal", "voice", "生物", "怪物", "鳴き声"}

    impact = any(word in text for word in impact_words)
    magic = any(word in text for word in magic_words)
    whoosh = any(word in text for word in whoosh_words)
    ui = any(word in text for word in ui_words)
    water = any(word in text for word in water_words)
    mech = any(word in text for word in mech_words)
    creature = any(word in text for word in creature_words)
    if not any([impact, magic, whoosh, ui, water, mech, creature]):
        impact = True
        magic = rng.random() > 0.5
        whoosh = rng.random() > 0.5

    if impact:
        length = min(frames, int(1.2 * SAMPLE_RATE))
        t = np.arange(length) / SAMPLE_RATE
        boom = np.sin(2 * np.pi * np.cumsum(np.geomspace(120, 32, length)) / SAMPLE_RATE)
        boom *= np.exp(-t * 5.5)
        _place(mix, (boom * 0.9)[:, None], 0, 0.9)
        noise_burst(1.0, 2200.0, 0.18, 0.5, 0.0)
    if whoosh:
        length = min(frames, int(min(2.5, request.duration) * SAMPLE_RATE))
        noise = rng.standard_normal(length).astype(np.float32)
        noise = _lowpass(noise, 1800.0)
        envelope = np.sin(np.linspace(0, np.pi, length, dtype=np.float32)) ** 2
        pan_curve = np.linspace(-0.8, 0.8, length, dtype=np.float32)
        left = noise * envelope * (1.0 - pan_curve) * 0.5
        right = noise * envelope * (1.0 + pan_curve) * 0.5
        _place(mix, np.stack([left, right], axis=1), 0, 0.7)
    if magic:
        for _index in range(10):
            start = int(rng.uniform(0, max(0.01, request.duration - 0.4)) * SAMPLE_RATE)
            freq = rng.uniform(1200, 4800)
            length = min(int(0.4 * SAMPLE_RATE), frames - start)
            if length <= 0:
                continue
            env = _adsr(length, 0.01, 0.1, 0.2, 0.25)
            shimmer = _oscillator(freq * (1 + 0.01 * np.sin(np.linspace(0, 20, length))), length, "sine")
            _place(mix, (shimmer * env * 0.18)[:, None], start, 1.0, rng.uniform(-0.8, 0.8))
        tone_sweep(400, 2400, min(1.8, request.duration), 0.2, "triangle")
    if ui:
        length = min(frames, int(0.14 * SAMPLE_RATE))
        env = np.exp(-np.arange(length) / (SAMPLE_RATE * 0.025))
        click = _oscillator(1800, length, "sine") * env
        _place(mix, (click * 0.5)[:, None], 0, 1.0, 0.1)
        _place(mix, (click * 0.35)[:, None], int(0.05 * SAMPLE_RATE), 1.0, -0.1)
    if water:
        length = min(frames, int(1.5 * SAMPLE_RATE))
        water = _lowpass(rng.standard_normal(length).astype(np.float32), 900.0)
        water *= np.sin(np.linspace(0, np.pi, length, dtype=np.float32)) ** 2
        _place(mix, (water * 0.4)[:, None], 0, 1.0)
        for _index in range(8):
            start = int(rng.uniform(0, max(0.01, request.duration - 0.2)) * SAMPLE_RATE)
            length = min(int(0.18 * SAMPLE_RATE), frames - start)
            if length <= 0:
                continue
            freq = np.linspace(rng.uniform(500, 900), rng.uniform(1200, 2000), length)
            drop = _oscillator(freq, length, "sine") * np.exp(
                -np.arange(length) / (SAMPLE_RATE * 0.03)
            )
            _place(mix, (drop * 0.18)[:, None], start, 1.0, rng.uniform(-0.6, 0.6))
    if mech:
        length = min(frames, int(min(2.0, request.duration) * SAMPLE_RATE))
        hum = _oscillator(60, length, "saw") * 0.12
        hum += _oscillator(120, length, "sine") * 0.08
        _place(mix, (hum * _adsr(length, 0.02, 0.1, 0.9, 0.2))[:, None], 0, 1.0)
        for _ in range(4):
            start = int(rng.uniform(0, max(0.01, request.duration - 0.2)) * SAMPLE_RATE)
            length = min(int(0.08 * SAMPLE_RATE), frames - start)
            if length <= 0:
                continue
            clank = _oscillator(rng.uniform(200, 500), length, "triangle") * np.exp(
                -np.arange(length) / (SAMPLE_RATE * 0.02)
            )
            _place(mix, (clank * 0.25)[:, None], start, 1.0, rng.uniform(-0.7, 0.7))
    if creature:
        length = min(frames, int(min(1.8, request.duration) * SAMPLE_RATE))
        base = np.linspace(220, 90, length)
        growl = _oscillator(base * (1 + 0.03 * np.sin(np.linspace(0, 40, length))), length, "saw")
        growl = _lowpass(growl, 700.0) * _adsr(length, 0.05, 0.2, 0.6, 0.4)
        _place(mix, (growl * 0.35)[:, None], 0, 1.0)

    if not np.any(mix):
        tone_sweep(600, 180, min(1.0, request.duration), 0.5, "sine")
    if request.params.loop:
        mix = dsp.make_loop(mix, 0.4, SAMPLE_RATE)
    chain = [
        EffectSpec(type="reverb", params={**effects.DEFAULT_EFFECTS["reverb"], "mix": 0.14}),
        EffectSpec(type="limiter", params=effects.DEFAULT_EFFECTS["limiter"]),
    ]
    mix = effects.apply_chain(mix, SAMPLE_RATE, chain)
    mix = dsp.fade(mix, 0.01, min(0.3, request.duration / 4), SAMPLE_RATE)
    return dsp.normalize(_pad(mix, frames), -1.0)


def _ambient(request: GenerationRequest, rng: np.random.Generator) -> np.ndarray:
    frames = int(request.duration * SAMPLE_RATE)
    text = f"{request.prompt} {request.params.style or ''}".lower()
    mix = np.zeros((frames, 2), dtype=np.float32)
    t = np.arange(frames, dtype=np.float32) / SAMPLE_RATE

    def add_layer(signal: np.ndarray, gain: float, pan: float = 0.0) -> None:
        _place(mix, signal[:, None], 0, gain, pan)

    rain = any(word in text for word in {"rain", "雨", "storm", "downpour"})
    wind = any(word in text for word in {"wind", "風", "breeze", "gust"})
    fire = any(word in text for word in {"fire", "campfire", "炎", "焚き火", "flame"})
    forest = any(word in text for word in {"forest", "森", "bird", "小鳥", "nature", "自然"})
    city = any(word in text for word in {"city", "urban", "街", "traffic", "cityscape"})
    machine = any(word in text for word in {"machine", "factory", "工場", "engine", "space", "宇宙"})
    waves = any(word in text for word in {"waves", "ocean", "sea", "波", "海"})
    if not any([rain, wind, fire, forest, city, machine, waves]):
        rain = rng.random() > 0.5
        wind = not rain
        forest = True

    if rain:
        hiss = _highpass(rng.standard_normal(frames).astype(np.float32), 700.0)
        hiss *= 0.6 + 0.4 * np.sin(2 * np.pi * 0.07 * t)
        add_layer(hiss, 0.22, 0.0)
        for _ in range(int(max(4, request.duration * 6))):
            start = int(rng.uniform(0, max(0.01, request.duration)) * SAMPLE_RATE)
            length = min(int(0.12 * SAMPLE_RATE), frames - start)
            if length <= 0:
                continue
            drop = _oscillator(np.linspace(1400, 2600, length), length, "sine")
            drop *= np.exp(-np.arange(length) / (SAMPLE_RATE * 0.02))
            _place(mix, (drop * 0.07)[:, None], start, 1.0, rng.uniform(-0.8, 0.8))
    if wind:
        breeze = _lowpass(rng.standard_normal(frames).astype(np.float32), 450.0)
        breeze *= 0.35 + 0.65 * (0.5 + 0.5 * np.sin(2 * np.pi * 0.045 * t + 1.2))
        add_layer(breeze, 0.32, -0.2)
        add_layer(np.roll(breeze, 2205), 0.25, 0.25)
    if fire:
        crackle = np.zeros(frames, dtype=np.float32)
        for _ in range(int(max(6, request.duration * 8))):
            start = int(rng.uniform(0, max(0.01, request.duration)) * SAMPLE_RATE)
            length = min(int(0.03 * SAMPLE_RATE), frames - start)
            if length <= 0:
                continue
            pop = rng.standard_normal(length).astype(np.float32)
            pop *= np.exp(-np.arange(length) / (SAMPLE_RATE * 0.004))
            crackle[start : start + length] += pop * rng.uniform(0.2, 0.7)
        add_layer(crackle, 0.28, 0.3)
        rumble = _lowpass(rng.standard_normal(frames).astype(np.float32), 180.0)
        add_layer(rumble, 0.10)
    if forest:
        for _ in range(max(3, int(request.duration / 2))):
            start = int(rng.uniform(0, max(0.01, request.duration - 0.5)) * SAMPLE_RATE)
            length = min(int(0.35 * SAMPLE_RATE), frames - start)
            if length <= 0:
                continue
            base = rng.uniform(1800, 3600)
            chirp = _oscillator(
                base * (1 + 0.12 * np.sin(np.linspace(0, 18, length))), length, "sine"
            )
            chirp *= np.sin(np.linspace(0, np.pi, length, dtype=np.float32)) ** 2
            _place(mix, (chirp * 0.05)[:, None], start, 1.0, rng.uniform(-0.9, 0.9))
        leaves = _highpass(rng.standard_normal(frames).astype(np.float32), 2500.0)
        leaves *= 0.4 + 0.6 * np.sin(2 * np.pi * 0.11 * t) ** 2
        add_layer(leaves, 0.05)
    if city:
        traffic = _lowpass(rng.standard_normal(frames).astype(np.float32), 220.0)
        traffic *= 0.7 + 0.3 * np.sin(2 * np.pi * 0.03 * t)
        add_layer(traffic, 0.18)
        hum = _oscillator(100, frames, "sine") * 0.04 + _oscillator(150, frames, "sine") * 0.02
        add_layer(hum, 0.8)
    if machine:
        hum = _oscillator(55, frames, "saw") * 0.10 + _oscillator(110.5, frames, "sine") * 0.05
        hum *= 0.6 + 0.4 * np.sin(2 * np.pi * 0.2 * t) ** 2
        add_layer(hum, 0.8)
        whine = _oscillator(880, frames, "sine") * 0.015
        add_layer(whine, 0.8, 0.4)
    if waves:
        swell = 0.25 + 0.75 * (0.5 + 0.5 * np.sin(2 * np.pi * 0.08 * t - 1.5)) ** 2
        surf = _lowpass(rng.standard_normal(frames).astype(np.float32), 1200.0) * swell
        add_layer(surf, 0.30, -0.1)
        surf2 = np.roll(surf, 8820) * 0.7
        add_layer(surf2, 0.22, 0.2)

    if request.params.loop:
        mix = dsp.make_loop(mix, 2.0, SAMPLE_RATE)
    chain = [EffectSpec(type="limiter", params=effects.DEFAULT_EFFECTS["limiter"])]
    mix = effects.apply_chain(mix, SAMPLE_RATE, chain)
    mix = dsp.fade(mix, min(1.5, request.duration / 8), min(1.5, request.duration / 8), SAMPLE_RATE)
    return dsp.normalize(_pad(mix, frames), -2.0)


def generate(
    request: GenerationRequest,
    variation: int = 0,
    progress: ProgressCallback | None = None,
) -> tuple[np.ndarray, int]:
    seed = _seed_from_request(request, variation)
    rng = np.random.default_rng(seed)
    if progress:
        progress(0.05, "Preparing sketch engine")
    if request.task == "music":
        audio = _music(request, rng)
    elif request.task == "sfx":
        audio = _sfx(request, rng)
    else:
        audio = _ambient(request, rng)
    if progress:
        progress(0.85, "Finishing audio")
    if request.params.quality == "high":
        audio = dsp.normalize(audio, -0.8)
    if progress:
        progress(0.95, "Writing audio")
    return audio.astype(np.float32), SAMPLE_RATE
