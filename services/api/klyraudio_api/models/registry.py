"""Model metadata registry.

Licenses are recorded from the model publishers' own model cards and license
files (verified 2026-11). Klyraudio does not redistribute any model weights.
Models whose licenses restrict commercial use are labeled explicitly.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from ..schemas import ModelCapability


@dataclass(frozen=True)
class ModelDefinition:
    id: str
    name: str
    family: str
    description: str
    tasks: list[str]
    capabilities: list[ModelCapability]
    runtime: list[str]
    operating_systems: list[str]
    acceleration: list[str]
    vram_estimate_mb: int | None
    ram_estimate_mb: int | None
    size_bytes: int | None
    source_url: str
    license_name: str
    license_url: str
    commercial_use: str
    redistribution: str
    bundling: str
    known_limitations: list[str]
    adapter: str
    builtin: bool = False
    repo_id: str | None = None
    exclude_files: list[str] = field(default_factory=list)
    gated: bool = False
    requires_license_acknowledgement: bool = True


def _cap(
    task: str,
    params: list[str],
    duration_min: float,
    duration_max: float,
    *,
    negative: bool = False,
    loop: bool = False,
    variations: int = 4,
) -> ModelCapability:
    return ModelCapability(
        task=task,  # type: ignore[arg-type]
        supported_parameters=params,
        duration_min=duration_min,
        duration_max=duration_max,
        supports_negative_prompt=negative,
        supports_seed=True,
        supports_variations=True,
        supports_loop=loop,
        max_variations=variations,
    )


SKETCH_PARAMS = [
    "prompt",
    "duration",
    "seed",
    "variations",
    "tempo",
    "musical_key",
    "mood",
    "style",
    "instrumental",
    "loop",
    "quality",
]

SKETCH = ModelDefinition(
    id="klyraudio-sketch",
    name="Klyraudio Sketch (DSP)",
    family="Procedural DSP",
    description=(
        "Klyraudio's built-in synthesizer. It creates music, sound effects, and ambient "
        "soundscapes with deterministic signal processing. This is not an AI model: it works "
        "on any CPU with no model download and is intended as an immediate, dependable tool."
    ),
    tasks=["music", "sfx", "ambient"],
    capabilities=[
        _cap("music", SKETCH_PARAMS, 1, 300, loop=True),
        _cap("sfx", [p for p in SKETCH_PARAMS if p != "instrumental"], 1, 300, loop=True),
        _cap("ambient", [p for p in SKETCH_PARAMS if p != "instrumental"], 1, 300, loop=True),
    ],
    runtime=["python", "numpy"],
    operating_systems=["Windows", "macOS", "Linux"],
    acceleration=["cpu"],
    vram_estimate_mb=0,
    ram_estimate_mb=512,
    size_bytes=0,
    source_url="https://github.com/woxlo1/Klyraudio",
    license_name="GPL-3.0-only (part of Klyraudio)",
    license_url="https://www.gnu.org/licenses/gpl-3.0.html",
    commercial_use="permitted",
    redistribution="permitted",
    bundling="builtin",
    known_limitations=[
        "Rule-based DSP, not a neural model: it does not understand arbitrary descriptions as deeply as a generative model.",
        "Designed for sketches, placeholders, and lightweight sound design rather than production music.",
        "Quality depends on the built-in synthesis parameters, not on training data.",
    ],
    adapter="procedural",
    builtin=True,
    requires_license_acknowledgement=False,
)

MUSICGEN_PARAMS = ["prompt", "duration", "seed", "variations", "guidance"]

MUSICGEN_SMALL = ModelDefinition(
    id="musicgen-small",
    name="MusicGen Small",
    family="MusicGen (Meta)",
    description=(
        "A 300M-parameter text-to-music model. Generates short instrumental music clips of up "
        "to 30 seconds per request. Runs locally through PyTorch and Transformers."
    ),
    tasks=["music"],
    capabilities=[_cap("music", MUSICGEN_PARAMS, 1, 30)],
    runtime=["python", "torch", "transformers"],
    operating_systems=["Windows", "macOS", "Linux"],
    acceleration=["cuda", "mps", "cpu"],
    vram_estimate_mb=4000,
    ram_estimate_mb=6000,
    size_bytes=3_500_000_000,
    source_url="https://huggingface.co/facebook/musicgen-small",
    license_name="CC BY-NC 4.0 (model weights); MIT (code)",
    license_url="https://creativecommons.org/licenses/by-nc/4.0/",
    commercial_use="prohibited",
    redistribution="permitted",
    bundling="user-download",
    known_limitations=[
        "Model weights are licensed CC BY-NC 4.0: commercial use of generated audio is not permitted by the model license.",
        "Maximum generation length is about 30 seconds per clip.",
        "Instrumental music only; it does not generate intelligible singing.",
        "Tempo, key, mood, and style controls are not honored by this model. Klyraudio does not show them for this model.",
        "CPU inference is possible but slow; an NVIDIA GPU is strongly recommended.",
    ],
    adapter="musicgen",
    repo_id="facebook/musicgen-small",
    exclude_files=["pytorch_model.bin"],
)

MUSICGEN_MEDIUM = ModelDefinition(
    id="musicgen-medium",
    name="MusicGen Medium",
    family="MusicGen (Meta)",
    description=(
        "A 1.5B-parameter text-to-music model with higher audio quality than MusicGen Small. "
        "It requires substantially more VRAM and disk space."
    ),
    tasks=["music"],
    capabilities=[_cap("music", MUSICGEN_PARAMS, 1, 30)],
    runtime=["python", "torch", "transformers"],
    operating_systems=["Windows", "macOS", "Linux"],
    acceleration=["cuda", "mps", "cpu"],
    vram_estimate_mb=9000,
    ram_estimate_mb=16000,
    size_bytes=12_200_000_000,
    source_url="https://huggingface.co/facebook/musicgen-medium",
    license_name="CC BY-NC 4.0 (model weights); MIT (code)",
    license_url="https://creativecommons.org/licenses/by-nc/4.0/",
    commercial_use="prohibited",
    redistribution="permitted",
    bundling="user-download",
    known_limitations=[
        "Model weights are licensed CC BY-NC 4.0: commercial use of generated audio is not permitted by the model license.",
        "The download is roughly 12 GB and the model may not fit in 8 GB of VRAM.",
        "Maximum generation length is about 30 seconds per clip.",
        "Instrumental music only; it does not generate intelligible singing.",
        "Tempo, key, mood, and style controls are not honored by this model.",
    ],
    adapter="musicgen",
    repo_id="facebook/musicgen-medium",
    exclude_files=["pytorch_model.bin"],
)

STABLE_AUDIO_PARAMS = [
    "prompt",
    "negative_prompt",
    "duration",
    "seed",
    "variations",
    "guidance",
    "steps",
]

STABLE_AUDIO = ModelDefinition(
    id="stable-audio-open-1.0",
    name="Stable Audio Open 1.0",
    family="Stable Audio (Stability AI)",
    description=(
        "A text-to-audio diffusion model for music, sound effects, and ambient textures up to "
        "47 seconds. It supports negative prompts and diffusion step control."
    ),
    tasks=["music", "sfx", "ambient"],
    capabilities=[
        _cap("music", STABLE_AUDIO_PARAMS, 1, 47, negative=True),
        _cap("sfx", STABLE_AUDIO_PARAMS, 1, 47, negative=True),
        _cap("ambient", STABLE_AUDIO_PARAMS, 1, 47, negative=True, loop=True),
    ],
    runtime=["python", "torch", "diffusers", "transformers"],
    operating_systems=["Windows", "macOS", "Linux"],
    acceleration=["cuda", "mps", "cpu"],
    vram_estimate_mb=8000,
    ram_estimate_mb=12000,
    size_bytes=10_500_000_000,
    source_url="https://huggingface.co/stabilityai/stable-audio-open-1.0",
    license_name="Stability AI Community License",
    license_url="https://huggingface.co/stabilityai/stable-audio-open-1.0/blob/main/LICENSE.md",
    commercial_use="varies",
    redistribution="prohibited",
    bundling="user-download",
    known_limitations=[
        "The Stability AI Community License permits commercial use only under its revenue threshold and other terms; review the license before commercial use.",
        "The model repository is gated on Hugging Face. You must accept the license on the model page and provide an access token.",
        "Maximum generation length is about 47 seconds per clip.",
        "The download is roughly 10.5 GB and may not fit in 8 GB of VRAM without offloading.",
        "MPS support depends on the installed PyTorch and Diffusers versions and may be slow or unsupported for some operations.",
    ],
    adapter="stable-audio",
    repo_id="stabilityai/stable-audio-open-1.0",
    exclude_files=["model.ckpt", "vae_model.ckpt"],
    gated=True,
)

MODELS: list[ModelDefinition] = [
    SKETCH,
    MUSICGEN_SMALL,
    MUSICGEN_MEDIUM,
    STABLE_AUDIO,
]

MODEL_BY_ID: dict[str, ModelDefinition] = {model.id: model for model in MODELS}


def get_model(model_id: str) -> ModelDefinition | None:
    return MODEL_BY_ID.get(model_id)


def task_capability(model: ModelDefinition, task: str) -> ModelCapability | None:
    for capability in model.capabilities:
        if capability.task == task:
            return capability
    return None
