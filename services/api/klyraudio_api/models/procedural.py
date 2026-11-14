"""Klyraudio Sketch: the built-in, dependency-free procedural audio engine.

This engine is a real DSP synthesizer, not an AI model. It is clearly labeled as
non-AI in the UI and model registry. It provides immediate, fully local sound
generation on any CPU so that Klyraudio is usable before a user chooses to
install a large neural model.

Everything is deterministic for a given seed and prompt. The musical structure
(tempo, key, scale, progression, timbre, rhythm, and mix) is derived from a hash
of the prompt, so different prompts produce materially different sounds instead
of sharing one fallback arrangement. The variation index changes the seed and
the arrangement details while keeping the same prompt's identity.
"""

from __future__ import annotations

import hashlib
import math
from collections.abc import Callable
from dataclasses import dataclass

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

SCALES: dict[str, tuple[int, ...]] = {
    "major": (0, 2, 4, 5, 7, 9, 11),
    "mixolydian": (0, 2, 4, 5, 7, 9, 10),
    "lydian": (0, 2, 4, 6, 7, 9, 11),
    "dorian": (0, 2, 3, 5, 7, 9, 10),
    "natural_minor": (0, 2, 3, 5, 7, 8, 10),
    "phrygian": (0, 1, 3, 5, 7, 8, 10),
}

# Progressions use scale-degree indices so they follow the selected mode.
MAJOR_PROGRESSIONS: tuple[tuple[int, ...], ...] = (
    (0, 4, 5, 3),  # I–V–vi–IV
    (0, 5, 3, 4),  # I–vi–IV–V
    (0, 3, 5, 4),  # I–IV–vi–V
    (5, 3, 0, 4),  # vi–IV–I–V
    (0, 2, 3, 4),  # I–iii–IV–V
)
MINOR_PROGRESSIONS: tuple[tuple[int, ...], ...] = (
    (0, 5, 2, 6),  # i–VI–III–VII
    (0, 3, 5, 4),  # i–iv–VI–V
    (0, 6, 5, 6),  # i–VII–VI–VII
    (0, 2, 6, 3),  # i–III–VII–iv
    (0, 5, 3, 4),  # i–VI–iv–V
)

# Arpeggio figures are scale-step offsets above the current chord degree.
ARP_FIGURES: tuple[tuple[int, ...], ...] = (
    (0, 2, 4, 2, 4, 2, 0, 2),
    (0, 4, 2, 4, 0, 2, 4, 2),
    (0, 2, 4, 6, 4, 2, 0, 2),
    (0, 4, 6, 4, 2, 4, 0, 4),
    (0, 2, 0, 4, 2, 0, 4, 2),
    (0, 4, 2, 4, 7, 4, 2, 4),
)

# Eighth-note drum grids. Each entry is kick, snare, hat, or a rest.
DRUM_PATTERNS: tuple[tuple[str | None, ...], ...] = (
    ("k", None, "h", "s", "h", None, "k", "h"),
    ("k", "h", "s", "h", "k", None, "s", "h"),
    ("k", None, "s", None, "k", "h", "s", "h"),
    ("k", "h", "h", "s", "h", "k", "h", "s"),
    ("k", None, "h", None, "s", None, "h", None),
)

# Beat positions (in quarter notes) that receive a bass note.
BASS_RHYTHMS: tuple[tuple[int, ...], ...] = (
    (0,),
    (0, 2),
    (0, 1, 2, 3),
    (0, 2, 3),
)


@dataclass(frozen=True)
class MusicProfile:
    """Deterministic musical identity derived from a prompt."""

    bpm: int
    root: int
    scale: tuple[int, ...]
    progression: tuple[int, ...]
    arp_figure: tuple[int, ...]
    drum_pattern: tuple[str | None, ...]
    bass_beats: tuple[int, ...]
    pad_wave: str
    arp_wave: str
    bass_wave: str
    subdivision: int
    arp_octave: int
    chord_steps: tuple[int, ...]
    pad_gain: float
    arp_gain: float
    bass_gain: float
    drum_gain: float
    reverb_mix: float
    delay_mix: float
    swing: float
    detune: float
    pan_rate: float
    pan_width: float
    kick_base: float
    kick_floor: float
    kick_decay: float
    snare_cutoff: float
    hat_cutoff: float
    sub_gain: float
    minor: bool
    calm: bool
    energetic: bool


def _seed_from_request(request: GenerationRequest, variation: int) -> int:
    if request.seed is not None:
        return (request.seed + variation * 7919) & 0xFFFFFFFF
    digest = hashlib.sha256(f"{request.prompt}|{request.task}|{variation}".encode()).digest()
    return int.from_bytes(digest[:4], "big")


def _hash_bytes(*parts: object) -> bytes:
    # SHA-512 provides enough independent bytes for every profile field without
    # wrapping, which keeps profile derivation easy to audit.
    return hashlib.sha512("|".join(str(part) for part in parts).encode("utf-8")).digest()


def _unit(data: bytes, index: int) -> float:
    return data[index % len(data)] / 255.0


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


def _scale_note(scale: tuple[int, ...], degree: int) -> int:
    """Resolve a scale-step index (which may exceed the octave) to semitones."""
    octave, index = divmod(degree, len(scale))
    return octave * 12 + scale[index]


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


def music_profile(request: GenerationRequest) -> MusicProfile:
    """Derive tempo, key, mode, progression, timbre, and mix from the prompt.

    Explicit ``tempo`` and ``musical_key`` parameters win. Mood keywords narrow
    the candidate modes, and a hash of the prompt selects everything else. The
    profile deliberately ignores the variation index, so variations of one
    prompt share a musical identity while their seeds and ornamentation differ.
    """

    prompt = request.prompt.strip().lower()
    style = (request.params.style or "").strip().lower()
    mood = (request.params.mood or "").strip().lower()
    text = f"{prompt} {style} {mood}"
    digest = _hash_bytes(prompt, request.task, style, mood)

    minor = any(word in text for word in MINOR_WORDS)
    calm = any(word in text for word in CALM_WORDS)
    energetic = any(word in text for word in ENERGETIC_WORDS)

    if minor:
        mode_options = ("natural_minor", "dorian", "phrygian")
    elif calm:
        mode_options = ("major", "dorian", "lydian")
    elif energetic:
        mode_options = ("major", "mixolydian")
    else:
        mode_options = ("major", "dorian", "mixolydian", "lydian")
    mode = mode_options[digest[1] % len(mode_options)]
    scale = SCALES[mode]
    minor_mode = mode in {"natural_minor", "dorian", "phrygian"}

    progression_pool = MINOR_PROGRESSIONS if minor_mode else MAJOR_PROGRESSIONS
    progression = progression_pool[digest[2] % len(progression_pool)]

    if request.params.musical_key:
        root = _note_to_midi(request.params.musical_key, 45 if minor_mode else 48)
    else:
        root = (45 if minor_mode else 48) + digest[0] % 12

    if request.params.tempo:
        bpm = request.params.tempo
    else:
        if calm:
            bpm = 58 + digest[3] % 30
        elif energetic:
            bpm = 108 + digest[3] % 42
        else:
            bpm = 76 + digest[3] % 48
        if minor_mode:
            bpm -= 4
        bpm = max(40, min(210, bpm))

    pad_wave = ("triangle", "saw", "sine")[digest[9] % 3]
    if calm and pad_wave == "saw":
        pad_wave = "sine"
    arp_wave = ("sine", "triangle", "saw")[digest[10] % 3]
    if calm and arp_wave == "saw":
        arp_wave = "triangle"
    bass_wave = ("sine", "triangle")[digest[11] % 2]

    subdivision = 2 if calm else (2 if digest[21] % 2 == 0 else 4)
    arp_octave = 12 if calm else 24
    chord_steps = (0, 2, 4, 6) if not calm and digest[28] % 2 == 0 else (0, 2, 4)

    return MusicProfile(
        bpm=int(bpm),
        root=int(root),
        scale=scale,
        progression=progression,
        arp_figure=ARP_FIGURES[digest[19] % len(ARP_FIGURES)],
        drum_pattern=DRUM_PATTERNS[digest[20] % len(DRUM_PATTERNS)],
        bass_beats=BASS_RHYTHMS[digest[22] % len(BASS_RHYTHMS)],
        pad_wave=pad_wave,
        arp_wave=arp_wave,
        bass_wave=bass_wave,
        subdivision=subdivision,
        arp_octave=arp_octave,
        chord_steps=chord_steps,
        pad_gain=0.10 + _unit(digest, 5) * 0.10,
        arp_gain=0.07 + _unit(digest, 6) * 0.10,
        bass_gain=0.16 + _unit(digest, 7) * 0.12,
        drum_gain=0.0 if calm else 0.20 + _unit(digest, 8) * 0.14,
        reverb_mix=0.08 + _unit(digest, 13) * 0.22,
        delay_mix=0.0 if digest[14] % 3 else 0.08 + _unit(digest, 15) * 0.14,
        swing=0.0 if calm else 0.04 + _unit(digest, 12) * 0.12,
        detune=2.0 ** ((3 + digest[16] % 9) / 1200.0) - 1.0,
        pan_rate=0.35 + _unit(digest, 17) * 0.9,
        pan_width=0.15 + _unit(digest, 18) * 0.45,
        kick_base=float(85 + digest[23] % 45),
        kick_floor=float(34 + digest[24] % 20),
        kick_decay=float(8 + digest[25] % 8),
        snare_cutoff=float(1000 + digest[26] % 1200),
        hat_cutoff=float(5200 + digest[27] % 3000),
        sub_gain=0.0 if digest[29] % 2 else 0.08 + _unit(digest, 30) * 0.06,
        minor=minor_mode,
        calm=calm,
        energetic=energetic,
    )


def _music(request: GenerationRequest, rng: np.random.Generator) -> np.ndarray:
    frames = int(request.duration * SAMPLE_RATE)
    profile = music_profile(request)
    beat = 60.0 / max(30, min(300, profile.bpm))
    bar_frames = max(1, int(beat * 4 * SAMPLE_RATE))
    scale = profile.scale
    mix = np.zeros((frames, 2), dtype=np.float32)

    def add_kick(hit_start: int) -> None:
        length = min(int(0.30 * SAMPLE_RATE), frames - hit_start)
        if length <= 0:
            return
        t = np.arange(length, dtype=np.float32) / SAMPLE_RATE
        sweep = profile.kick_base * np.exp(-t * 22.0) + profile.kick_floor
        kick = np.sin(2 * np.pi * np.cumsum(sweep) / SAMPLE_RATE)
        kick *= np.exp(-t * profile.kick_decay)
        _place(mix, (kick * 0.9)[:, None], hit_start, profile.drum_gain)

    def add_snare(hit_start: int, gain: float = 1.0) -> None:
        length = min(int(0.20 * SAMPLE_RATE), frames - hit_start)
        if length <= 0:
            return
        noise = rng.standard_normal(length).astype(np.float32)
        noise = _highpass(noise, profile.snare_cutoff)
        noise *= np.exp(-np.arange(length) / (SAMPLE_RATE * 0.05))
        t = np.arange(length, dtype=np.float32) / SAMPLE_RATE
        body = _oscillator(180.0 + profile.snare_cutoff * 0.05, length, "triangle")
        body *= np.exp(-t * 32.0) * 0.25
        _place(mix, ((noise * 0.55 + body) * gain)[:, None], hit_start, profile.drum_gain, 0.05)

    def add_hat(hit_start: int) -> None:
        length = min(int(0.05 * SAMPLE_RATE), frames - hit_start)
        if length <= 0:
            return
        noise = rng.standard_normal(length).astype(np.float32)
        noise = _highpass(noise, profile.hat_cutoff)
        noise *= np.exp(-np.arange(length) / (SAMPLE_RATE * 0.012))
        _place(mix, (noise * 0.18)[:, None], hit_start, profile.drum_gain, -0.25)

    bar_count = max(1, math.ceil(frames / bar_frames))
    for bar in range(bar_count):
        start = bar * bar_frames
        if start >= frames:
            break
        degree = profile.progression[bar % len(profile.progression)]

        # Pad: detuned voices sustained across the bar.
        for step in profile.chord_steps:
            midi = profile.root + 12 + _scale_note(scale, degree + step)
            length = min(bar_frames, frames - start)
            if length <= 0:
                continue
            env = _adsr(length, 0.30 if profile.calm else 0.08, 0.22, 0.68, 0.38)
            freq = _midi_to_freq(midi)
            left = _oscillator(freq * (1.0 - profile.detune), length, profile.pad_wave)
            right = _oscillator(freq * (1.0 + profile.detune), length, profile.pad_wave, phase=0.7)
            wave = np.stack([left, right], axis=1) * env[:, None]
            _place(mix, wave, start, profile.pad_gain / len(profile.chord_steps))

        # Bass: rhythm and octave doubling come from the prompt profile.
        for beat_index in profile.bass_beats:
            note_start = start + int(beat_index * beat * SAMPLE_RATE)
            if note_start >= frames:
                continue
            length = min(int(beat * 1.7 * SAMPLE_RATE), frames - note_start)
            if length <= 0:
                continue
            env = _adsr(length, 0.01, 0.15, 0.55, 0.25)
            midi = profile.root - 12 + _scale_note(scale, degree)
            bass = _oscillator(_midi_to_freq(midi), length, profile.bass_wave) * env
            _place(mix, bass[:, None], note_start, profile.bass_gain)
            if profile.sub_gain > 0:
                sub = _oscillator(_midi_to_freq(midi - 12), length, "sine") * env
                _place(mix, sub[:, None], note_start, profile.sub_gain)

        # Arpeggio: figure, pan motion, swing, and velocity vary by prompt.
        step_length = max(1, int((beat / profile.subdivision) * SAMPLE_RATE))
        step_count = math.ceil(bar_frames / step_length)
        for step_index in range(step_count):
            offset = int(step_length * profile.swing) if step_index % 2 else 0
            note_start = start + step_index * step_length + offset
            if note_start >= frames:
                break
            length = min(int(step_length * 1.35), frames - note_start)
            if length <= 0:
                continue
            figure = profile.arp_figure[step_index % len(profile.arp_figure)]
            midi = profile.root + profile.arp_octave + _scale_note(scale, degree + figure)
            if not profile.calm and (step_index + bar) % 8 == 6:
                midi += 12
            env = _adsr(length, 0.005, 0.12, 0.15, 0.18)
            tone = _oscillator(
                _midi_to_freq(midi),
                length,
                profile.arp_wave,
                phase=float(rng.uniform(0.0, 2.0 * np.pi)),
            )
            velocity = 0.8 + float(rng.random()) * 0.35
            pan = math.sin((step_index + bar * 1.5) * profile.pan_rate) * profile.pan_width
            _place(mix, (tone * env)[:, None], note_start, profile.arp_gain * velocity, pan)

        # Drums: an eighth-note grid with hashed kit tuning.
        if profile.drum_gain > 0:
            eighth = beat / 2.0
            for index, hit in enumerate(profile.drum_pattern):
                if hit is None:
                    continue
                hit_start = start + int(index * eighth * SAMPLE_RATE)
                if index % 2:
                    hit_start += int(eighth * profile.swing * SAMPLE_RATE)
                if hit_start >= frames:
                    continue
                if hit == "k":
                    add_kick(hit_start)
                elif hit == "s":
                    add_snare(hit_start)
                else:
                    add_hat(hit_start)
            if bar % 4 == 3 and rng.random() < 0.4:
                add_snare(start + int(7.5 * eighth * SAMPLE_RATE), gain=0.6)

    mix *= 0.8
    if request.params.loop:
        mix = dsp.make_loop(mix, 1.5, SAMPLE_RATE)
    chain: list[EffectSpec] = []
    if not profile.calm:
        chain.append(EffectSpec(type="compressor", params=effects.DEFAULT_EFFECTS["compressor"]))
    if profile.delay_mix > 0:
        chain.append(
            EffectSpec(
                type="delay",
                params={
                    **effects.DEFAULT_EFFECTS["delay"],
                    "delay_ms": max(40.0, beat * 750.0),
                    "feedback": 0.28,
                    "mix": profile.delay_mix,
                },
            )
        )
    chain.append(
        EffectSpec(
            type="reverb",
            params={**effects.DEFAULT_EFFECTS["reverb"], "mix": profile.reverb_mix},
        )
    )
    chain.append(EffectSpec(type="limiter", params=effects.DEFAULT_EFFECTS["limiter"]))
    mix = effects.apply_chain(mix, SAMPLE_RATE, chain)
    return dsp.normalize(_pad(mix, frames), -1.0)


def _sfx(request: GenerationRequest, rng: np.random.Generator) -> np.ndarray:
    frames = int(request.duration * SAMPLE_RATE)
    prompt = request.prompt.strip().lower()
    style = (request.params.style or "").strip().lower()
    text = f"{prompt} {style}"
    digest = _hash_bytes(prompt, "sfx", style)
    mix = np.zeros((frames, 2), dtype=np.float32)

    def unit(index: int) -> float:
        return _unit(digest, index)

    def noise_burst(
        duration: float,
        cutoff: float,
        decay: float,
        gain: float,
        pan: float = 0.0,
        color: str = "low",
        start: float = 0.0,
    ) -> None:
        length = max(1, min(int(duration * SAMPLE_RATE), frames))
        noise = rng.standard_normal(length).astype(np.float32)
        if color == "high":
            noise = _highpass(noise, max(80.0, cutoff))
        else:
            noise = _lowpass(noise, max(80.0, cutoff))
        noise *= np.exp(-np.arange(length) / (SAMPLE_RATE * max(0.005, decay)))
        _place(mix, (noise * gain)[:, None], int(start * SAMPLE_RATE), 1.0, pan)

    def tone_sweep(
        start_freq: float,
        end_freq: float,
        duration: float,
        gain: float,
        kind: str,
        pan: float = 0.0,
        start: float = 0.0,
    ) -> None:
        length = max(1, min(int(duration * SAMPLE_RATE), frames))
        sweep = np.geomspace(max(20.0, start_freq), max(20.0, end_freq), length).astype(np.float32)
        env = _adsr(length, 0.005, 0.2, 0.3, 0.4)
        wave = _oscillator(sweep, length, kind) * env
        _place(mix, (wave * gain)[:, None], int(start * SAMPLE_RATE), 1.0, pan)

    # Every prompt gets a signature layer built from its hash before any
    # category recipe runs. Two prompts in the same category therefore still
    # differ in pitch, sweep, envelope, and stereo placement.
    base_freq = 70.0 * 2.0 ** (unit(0) * 7.2)
    sweep_ratio = 0.2 + unit(1) * 4.0
    signature_decay = 0.05 + unit(2) * 0.9
    signature_pan = -0.85 + unit(3) * 1.7
    signature_kind = ("sine", "triangle", "saw")[digest[4] % 3]
    start_freq = base_freq * (0.5 + unit(7))
    end_freq = start_freq * sweep_ratio if digest[8] % 2 else start_freq / max(0.2, sweep_ratio)
    tone_sweep(
        start_freq,
        end_freq,
        min(request.duration, 0.25 + unit(6) * request.duration),
        0.18 + unit(5) * 0.25,
        signature_kind,
        signature_pan,
        start=unit(9) * 0.2,
    )
    noise_burst(
        min(request.duration, 0.3 + unit(10) * request.duration),
        base_freq * (0.6 + unit(11) * 2.4),
        signature_decay,
        0.10 + unit(12) * 0.20,
        -signature_pan,
        color="high" if digest[13] % 2 else "low",
        start=unit(14) * 0.1,
    )

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
    keyword_hit = any([impact, magic, whoosh, ui, water, mech, creature])
    if not keyword_hit:
        # Pick two categories from the hash so the signature is never the only
        # layer and category-less prompts still sound structured.
        category_names = ("impact", "whoosh", "magic", "ui", "water", "mech", "creature")
        first = category_names[digest[20] % len(category_names)]
        second = category_names[(digest[21] + 3) % len(category_names)]
        impact = first == "impact" or second == "impact"
        whoosh = first == "whoosh" or second == "whoosh"
        magic = first == "magic" or second == "magic"
        ui = first == "ui" or second == "ui"
        water = first == "water" or second == "water"
        mech = first == "mech" or second == "mech"
        creature = first == "creature" or second == "creature"

    if impact:
        length = min(frames, int((0.6 + unit(22) * 1.2) * SAMPLE_RATE))
        t = np.arange(length) / SAMPLE_RATE
        low = 30.0 + unit(23) * 50.0
        high = 90.0 + unit(24) * 90.0
        boom = np.sin(2 * np.pi * np.cumsum(np.geomspace(high, low, length)) / SAMPLE_RATE)
        boom *= np.exp(-t * (3.5 + unit(25) * 5.0))
        _place(mix, (boom * 0.9)[:, None], 0, 0.75 + unit(26) * 0.25)
        noise_burst(
            0.5 + unit(27),
            1500.0 + unit(28) * 1800.0,
            0.10 + unit(29) * 0.25,
            0.35 + unit(30) * 0.25,
            -0.2 + unit(31) * 0.4,
            color="high",
        )
    if whoosh:
        duration = min(max(0.4, request.duration * (0.4 + unit(32))), 3.0)
        length = min(frames, int(duration * SAMPLE_RATE))
        noise = rng.standard_normal(length).astype(np.float32)
        noise = _lowpass(noise, 700.0 + unit(33) * 2600.0)
        envelope = np.sin(np.linspace(0, np.pi, length, dtype=np.float32)) ** 2
        pan_curve = np.linspace(-0.8 if digest[34] % 2 else 0.8, 0.8 if digest[34] % 2 else -0.8, length)
        left = noise * envelope * (1.0 - pan_curve.astype(np.float32)) * 0.5
        right = noise * envelope * (1.0 + pan_curve.astype(np.float32)) * 0.5
        _place(mix, np.stack([left, right], axis=1), 0, 0.5 + unit(35) * 0.3)
    if magic:
        count = 6 + digest[36] % 10
        low_freq = 800.0 + unit(37) * 1800.0
        high_freq = 2400.0 + unit(38) * 3200.0
        for _index in range(count):
            start = int(rng.uniform(0, max(0.01, request.duration - 0.4)) * SAMPLE_RATE)
            freq = rng.uniform(low_freq, high_freq)
            length = min(int(0.4 * SAMPLE_RATE), frames - start)
            if length <= 0:
                continue
            env = _adsr(length, 0.01, 0.1, 0.2, 0.25)
            shimmer = _oscillator(
                freq * (1 + 0.01 * np.sin(np.linspace(0, 20, length))),
                length,
                "sine" if digest[39] % 2 else "triangle",
            )
            _place(mix, (shimmer * env * 0.16)[:, None], start, 1.0, rng.uniform(-0.8, 0.8))
        tone_sweep(
            low_freq * 0.4,
            high_freq * 0.8,
            min(1.8, request.duration),
            0.15 + unit(40) * 0.15,
            "triangle",
        )
    if ui:
        freq = 900.0 + unit(41) * 2200.0
        length = min(frames, int((0.08 + unit(42) * 0.12) * SAMPLE_RATE))
        env = np.exp(-np.arange(length) / (SAMPLE_RATE * (0.015 + unit(43) * 0.03)))
        click = _oscillator(freq, length, "sine") * env
        _place(mix, (click * 0.5)[:, None], 0, 1.0, 0.1)
        _place(mix, (click * 0.35)[:, None], int(0.04 * SAMPLE_RATE), 1.0, -0.1)
    if water:
        length = min(frames, int((0.8 + unit(44)) * SAMPLE_RATE))
        water_signal = _lowpass(rng.standard_normal(length).astype(np.float32), 400.0 + unit(45) * 900.0)
        water_signal *= np.sin(np.linspace(0, np.pi, length, dtype=np.float32)) ** 2
        _place(mix, (water_signal * 0.35)[:, None], 0, 1.0)
        for _index in range(5 + digest[46] % 8):
            start = int(rng.uniform(0, max(0.01, request.duration - 0.2)) * SAMPLE_RATE)
            length = min(int(0.18 * SAMPLE_RATE), frames - start)
            if length <= 0:
                continue
            low_drop = 400.0 + unit(47) * 700.0
            high_drop = 1000.0 + unit(48) * 1200.0
            freq = np.linspace(rng.uniform(low_drop, high_drop * 0.7), rng.uniform(high_drop * 0.7, high_drop), length)
            drop = _oscillator(freq, length, "sine") * np.exp(
                -np.arange(length) / (SAMPLE_RATE * 0.03)
            )
            _place(mix, (drop * 0.16)[:, None], start, 1.0, rng.uniform(-0.6, 0.6))
    if mech:
        length = min(frames, int(min(2.0, request.duration) * SAMPLE_RATE))
        hum_freq = 40.0 + unit(49) * 70.0
        hum = _oscillator(hum_freq, length, "saw") * 0.12
        hum += _oscillator(hum_freq * (1.5 + unit(50)), length, "sine") * 0.08
        _place(mix, (hum * _adsr(length, 0.02, 0.1, 0.9, 0.2))[:, None], 0, 1.0)
        for _index in range(3 + digest[51] % 4):
            start = int(rng.uniform(0, max(0.01, request.duration - 0.2)) * SAMPLE_RATE)
            length = min(int(0.08 * SAMPLE_RATE), frames - start)
            if length <= 0:
                continue
            clank_freq = 150.0 + unit(52) * 650.0
            clank = _oscillator(clank_freq, length, "triangle") * np.exp(
                -np.arange(length) / (SAMPLE_RATE * 0.02)
            )
            _place(mix, (clank * 0.22)[:, None], start, 1.0, rng.uniform(-0.7, 0.7))
    if creature:
        length = min(frames, int(min(1.8, request.duration) * SAMPLE_RATE))
        start_freq = 140.0 + unit(53) * 220.0
        end_freq = 50.0 + unit(54) * 90.0
        base = np.linspace(start_freq, end_freq, length)
        modulation = 0.02 + unit(55) * 0.05
        growl = _oscillator(
            base * (1 + modulation * np.sin(np.linspace(0, 20 + unit(56) * 40, length))),
            length,
            "saw" if digest[57] % 2 else "triangle",
        )
        growl = _lowpass(growl, 500.0 + unit(58) * 700.0) * _adsr(length, 0.05, 0.2, 0.6, 0.4)
        _place(mix, (growl * 0.32)[:, None], 0, 1.0)

    if not np.any(mix):
        tone_sweep(600, 180, min(1.0, request.duration), 0.5, "sine", signature_pan)
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
    prompt = request.prompt.strip().lower()
    style = (request.params.style or "").strip().lower()
    text = f"{prompt} {style}"
    digest = _hash_bytes(prompt, "ambient", style)
    mix = np.zeros((frames, 2), dtype=np.float32)
    t = np.arange(frames, dtype=np.float32) / SAMPLE_RATE

    def unit(index: int) -> float:
        return _unit(digest, index)

    def add_layer(signal: np.ndarray, gain: float, pan: float = 0.0) -> None:
        _place(mix, signal[:, None], 0, gain, pan)

    # A hashed bed and drone give every prompt its own spectrum and movement
    # even when the category layers overlap.
    bed = _lowpass(rng.standard_normal(frames).astype(np.float32), 150.0 + unit(0) * 1200.0)
    bed_rate = 0.02 + unit(1) * 0.15
    bed *= 0.35 + 0.65 * (0.5 + 0.5 * np.sin(2 * np.pi * bed_rate * t + unit(2) * 6.0))
    add_layer(bed, 0.05 + unit(3) * 0.08, -0.4 + unit(4) * 0.8)

    drone_freq = 38.0 * 2.0 ** (unit(5) * 4.5)
    drone_kind = ("sine", "triangle", "saw")[digest[6] % 3]
    drone_mod = 0.55 + 0.45 * np.sin(2 * np.pi * (0.03 + unit(7) * 0.2) * t)
    drone = _oscillator(drone_freq, frames, drone_kind) * drone_mod
    drone_gain = 0.012 + unit(8) * 0.025
    add_layer(drone, drone_gain, -0.3 + unit(9) * 0.6)
    add_layer(
        _oscillator(drone_freq * (1.0 + 0.003 + unit(10) * 0.01), frames, "sine") * drone_mod,
        drone_gain * 0.7,
        0.3 - unit(9) * 0.6,
    )

    rain = any(word in text for word in {"rain", "雨", "storm", "downpour"})
    wind = any(word in text for word in {"wind", "風", "breeze", "gust"})
    fire = any(word in text for word in {"fire", "campfire", "炎", "焚き火", "flame"})
    forest = any(word in text for word in {"forest", "森", "bird", "小鳥", "nature", "自然"})
    city = any(word in text for word in {"city", "urban", "街", "traffic", "cityscape"})
    machine = any(word in text for word in {"machine", "factory", "工場", "engine", "space", "宇宙"})
    waves = any(word in text for word in {"waves", "ocean", "sea", "波", "海"})
    if not any([rain, wind, fire, forest, city, machine, waves]):
        names = ("rain", "wind", "fire", "forest", "city", "machine", "waves")
        flags = {
            "rain": False,
            "wind": False,
            "fire": False,
            "forest": False,
            "city": False,
            "machine": False,
            "waves": False,
        }
        flags[names[digest[11] % len(names)]] = True
        flags[names[(digest[12] + 3) % len(names)]] = True
        rain = flags["rain"]
        wind = flags["wind"]
        fire = flags["fire"]
        forest = flags["forest"]
        city = flags["city"]
        machine = flags["machine"]
        waves = flags["waves"]

    if rain:
        hiss = _highpass(rng.standard_normal(frames).astype(np.float32), 500.0 + unit(13) * 900.0)
        hiss *= 0.55 + 0.45 * np.sin(2 * np.pi * (0.04 + unit(14) * 0.12) * t)
        add_layer(hiss, 0.14 + unit(15) * 0.14, -0.2 + unit(16) * 0.4)
        for _ in range(int(max(3, request.duration * (3 + digest[17] % 7)))):
            start = int(rng.uniform(0, max(0.01, request.duration)) * SAMPLE_RATE)
            length = min(int(0.12 * SAMPLE_RATE), frames - start)
            if length <= 0:
                continue
            low_drop = 800.0 + unit(18) * 1200.0
            drop = _oscillator(np.linspace(low_drop, low_drop * (1.5 + unit(19)), length), length, "sine")
            drop *= np.exp(-np.arange(length) / (SAMPLE_RATE * 0.02))
            _place(mix, (drop * 0.06)[:, None], start, 1.0, rng.uniform(-0.8, 0.8))
    if wind:
        breeze = _lowpass(rng.standard_normal(frames).astype(np.float32), 250.0 + unit(20) * 650.0)
        breeze_rate = 0.02 + unit(21) * 0.15
        breeze *= 0.3 + 0.7 * (0.5 + 0.5 * np.sin(2 * np.pi * breeze_rate * t + unit(22) * 6.0))
        add_layer(breeze, 0.22 + unit(23) * 0.14, -0.4 + unit(24) * 0.2)
        add_layer(np.roll(breeze, int(SAMPLE_RATE * (0.02 + unit(25) * 0.08))), 0.18, 0.25)
    if fire:
        crackle = np.zeros(frames, dtype=np.float32)
        for _ in range(int(max(5, request.duration * (4 + digest[26] % 8)))):
            start = int(rng.uniform(0, max(0.01, request.duration)) * SAMPLE_RATE)
            length = min(int(0.03 * SAMPLE_RATE), frames - start)
            if length <= 0:
                continue
            pop = rng.standard_normal(length).astype(np.float32)
            pop *= np.exp(-np.arange(length) / (SAMPLE_RATE * 0.004))
            crackle[start : start + length] += pop * rng.uniform(0.2, 0.7)
        add_layer(crackle, 0.24 + unit(27) * 0.12, 0.3)
        rumble = _lowpass(rng.standard_normal(frames).astype(np.float32), 100.0 + unit(28) * 220.0)
        add_layer(rumble, 0.08 + unit(29) * 0.06)
    if forest:
        chirp_base = 1400.0 + unit(30) * 3000.0
        for _ in range(max(3, int(request.duration * (0.8 + unit(31) * 2.0)))):
            start = int(rng.uniform(0, max(0.01, request.duration - 0.5)) * SAMPLE_RATE)
            length = min(int(0.35 * SAMPLE_RATE), frames - start)
            if length <= 0:
                continue
            base = chirp_base * (0.6 + rng.random() * 0.8)
            chirp = _oscillator(
                base * (1 + 0.12 * np.sin(np.linspace(0, 12 + unit(32) * 18, length))),
                length,
                "sine",
            )
            chirp *= np.sin(np.linspace(0, np.pi, length, dtype=np.float32)) ** 2
            _place(mix, (chirp * 0.05)[:, None], start, 1.0, rng.uniform(-0.9, 0.9))
        leaves = _highpass(rng.standard_normal(frames).astype(np.float32), 1800.0 + unit(33) * 1400.0)
        leaves *= 0.4 + 0.6 * np.sin(2 * np.pi * (0.05 + unit(34) * 0.14) * t) ** 2
        add_layer(leaves, 0.04 + unit(35) * 0.03)
    if city:
        traffic = _lowpass(rng.standard_normal(frames).astype(np.float32), 120.0 + unit(36) * 220.0)
        traffic *= 0.6 + 0.4 * np.sin(2 * np.pi * (0.02 + unit(37) * 0.08) * t)
        add_layer(traffic, 0.14 + unit(38) * 0.08)
        hum_freq = 80.0 + unit(39) * 60.0
        hum = _oscillator(hum_freq, frames, "sine") * 0.04 + _oscillator(
            hum_freq * 1.5, frames, "sine"
        ) * 0.02
        add_layer(hum, 0.8)
    if machine:
        hum_freq = 40.0 + unit(40) * 60.0
        hum = _oscillator(hum_freq, frames, "saw") * 0.10 + _oscillator(
            hum_freq * (1.5 + unit(41) * 0.6), frames, "sine"
        ) * 0.05
        hum *= 0.6 + 0.4 * np.sin(2 * np.pi * (0.1 + unit(42) * 0.25) * t) ** 2
        add_layer(hum, 0.8)
        whine = _oscillator(600.0 + unit(43) * 1200.0, frames, "sine") * 0.015
        add_layer(whine, 0.8, 0.4)
    if waves:
        swell_rate = 0.03 + unit(44) * 0.15
        swell = 0.25 + 0.75 * (0.5 + 0.5 * np.sin(2 * np.pi * swell_rate * t - 1.5)) ** 2
        surf = _lowpass(rng.standard_normal(frames).astype(np.float32), 500.0 + unit(45) * 1500.0) * swell
        add_layer(surf, 0.20 + unit(46) * 0.14, -0.1)
        surf2 = np.roll(surf, int(SAMPLE_RATE * (0.1 + unit(47) * 0.2))) * 0.7
        add_layer(surf2, 0.16 + unit(48) * 0.12, 0.2)

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
