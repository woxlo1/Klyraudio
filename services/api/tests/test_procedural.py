"""Determinism and prompt-variation tests for the built-in Sketch engine."""

from __future__ import annotations

import numpy as np
import pytest

from klyraudio_api.models import procedural
from klyraudio_api.schemas import GenerationParams, GenerationRequest

MUSIC_PROMPTS = [
    "slow rainy night piano for a quiet film scene",
    "driving synthwave chase at midnight",
    "gentle sunrise strings for a peaceful garden",
    "sad dark hollow drone under a ruined city",
]


def make_request(
    prompt: str,
    task: str = "music",
    duration: float = 2.0,
    **params: object,
) -> GenerationRequest:
    return GenerationRequest(
        model_id="klyraudio-sketch",
        task=task,
        prompt=prompt,
        duration=duration,
        variations=1,
        params=GenerationParams(**params),
    )


def mean_difference(first: np.ndarray, second: np.ndarray) -> float:
    return float(np.mean(np.abs(first - second)))


def test_prompt_drives_musical_structure() -> None:
    profiles = [procedural.music_profile(make_request(prompt)) for prompt in MUSIC_PROMPTS]
    signatures = {
        (profile.bpm, profile.root, profile.scale, profile.progression) for profile in profiles
    }
    assert len(signatures) >= len(MUSIC_PROMPTS) - 1


def test_different_prompts_produce_different_audio() -> None:
    clips = [procedural.generate(make_request(prompt))[0] for prompt in MUSIC_PROMPTS[:3]]
    for index, first in enumerate(clips):
        for second in clips[index + 1 :]:
            assert mean_difference(first, second) > 0.02


def test_same_prompt_is_deterministic() -> None:
    request = make_request(MUSIC_PROMPTS[0])
    first, first_rate = procedural.generate(request, variation=0)
    second, second_rate = procedural.generate(request, variation=0)
    assert first_rate == second_rate
    assert np.array_equal(first, second)


def test_variations_of_one_prompt_differ_but_stay_related() -> None:
    request = make_request(MUSIC_PROMPTS[0])
    first, _ = procedural.generate(request, variation=0)
    second, _ = procedural.generate(request, variation=1)
    assert not np.array_equal(first, second)
    assert mean_difference(first, second) > 0.005


def test_explicit_tempo_and_key_win() -> None:
    profile = procedural.music_profile(
        make_request(MUSIC_PROMPTS[1], tempo=61, musical_key="F#2")
    )
    assert profile.bpm == 61
    assert profile.root == procedural._note_to_midi("F#2")


def test_mood_keywords_constrain_tempo_and_mode() -> None:
    calm = procedural.music_profile(make_request("calm ambient meditation texture"))
    energetic = procedural.music_profile(make_request("fast energetic dance track"))
    sad = procedural.music_profile(make_request("sad dark melancholy theme"))

    assert calm.calm is True
    assert calm.bpm < 90
    assert energetic.bpm >= 108
    assert sad.minor is True
    assert sad.scale in {
        procedural.SCALES["natural_minor"],
        procedural.SCALES["dorian"],
        procedural.SCALES["phrygian"],
    }


@pytest.mark.parametrize(
    ("task", "prompts", "threshold"),
    [
        ("sfx", ("soft magical sparkle", "heavy mechanical impact"), 0.005),
        ("ambient", ("gentle forest rain at dawn", "cold industrial machine room"), 0.005),
    ],
)
def test_non_music_tasks_vary_by_prompt(
    task: str, prompts: tuple[str, str], threshold: float
) -> None:
    first_request = make_request(prompts[0], task=task, duration=1.0)
    second_request = make_request(prompts[1], task=task, duration=1.0)

    first, _ = procedural.generate(first_request)
    repeat, _ = procedural.generate(first_request)
    second, _ = procedural.generate(second_request)

    assert np.array_equal(first, repeat)
    assert mean_difference(first, second) > threshold


def test_generated_audio_is_finite_and_stereo() -> None:
    audio, sample_rate = procedural.generate(make_request(MUSIC_PROMPTS[3], duration=1.0))
    assert sample_rate == procedural.SAMPLE_RATE
    assert audio.shape == (procedural.SAMPLE_RATE, 2)
    assert audio.dtype == np.float32
    assert np.isfinite(audio).all()
