"""Generation adapter interface and concrete local adapters."""

from __future__ import annotations

import gc
import importlib.util
import random
from collections.abc import Callable
from dataclasses import dataclass

import numpy as np

from ..audio import dsp, effects
from ..errors import ApiError, DependencyMissing, OutOfMemory
from ..schemas import EffectSpec, GenerationRequest
from .procedural import generate as generate_sketch
from .registry import ModelDefinition

ProgressCallback = Callable[[float | None, str], None]
CancelCheck = Callable[[], bool]


class GenerationCancelled(Exception):
    """Raised internally when a user cancels a running job."""


@dataclass
class AudioResult:
    audio: np.ndarray
    sample_rate: int
    # True when the underlying model does not expose real progress.
    indeterminate: bool = False


def _find_spec(name: str) -> bool:
    try:
        return importlib.util.find_spec(name) is not None
    except (ImportError, ValueError):
        return False


def missing_dependencies(packages: list[str]) -> list[str]:
    return [package for package in packages if not _find_spec(package)]


def _seed_for(request: GenerationRequest, index: int) -> int:
    if request.seed is not None:
        return (request.seed + index * 7919) & 0x7FFFFFFF
    base = random.Random(f"{request.prompt}:{request.task}:{index}").getrandbits(31)
    return base


def _check_cancel(cancelled: CancelCheck) -> None:
    if cancelled():
        raise GenerationCancelled()


def _postprocess(
    audio: np.ndarray,
    sample_rate: int,
    request: GenerationRequest,
    *,
    loop: bool = False,
) -> np.ndarray:
    output = dsp.normalize(np.asarray(audio, dtype=np.float32), -1.0)
    if loop:
        output = dsp.make_loop(output, 1.0, sample_rate)
    chain = [
        EffectSpec(
            type="limiter",
            params={"ceiling_db": -0.3},
        )
    ]
    return effects.apply_chain(output, sample_rate, chain)


class Adapter:
    def __init__(self, definition: ModelDefinition, install_path: str | None, device: str) -> None:
        self.definition = definition
        self.install_path = install_path
        self.device = device

    def availability(self) -> tuple[bool, str | None]:
        raise NotImplementedError

    def generate_batch(
        self,
        request: GenerationRequest,
        count: int,
        progress: ProgressCallback,
        cancelled: CancelCheck,
    ) -> list[AudioResult]:
        raise NotImplementedError


class ProceduralAdapter(Adapter):
    def availability(self) -> tuple[bool, str | None]:
        return True, None

    def generate_batch(
        self,
        request: GenerationRequest,
        count: int,
        progress: ProgressCallback,
        cancelled: CancelCheck,
    ) -> list[AudioResult]:
        results: list[AudioResult] = []
        for index in range(count):
            _check_cancel(cancelled)

            def report(value: float | None, label: str, i: int = index) -> None:
                if value is not None:
                    value = (i + value) / count
                progress(value, f"{label} ({i + 1}/{count})")

            audio, sample_rate = generate_sketch(request, variation=index, progress=report)
            _check_cancel(cancelled)
            results.append(AudioResult(audio=audio, sample_rate=sample_rate))
        return results


class MusicGenAdapter(Adapter):
    def availability(self) -> tuple[bool, str | None]:
        if not self.install_path:
            return False, "Model files are not installed."
        missing = missing_dependencies(["torch", "transformers"])
        if missing:
            return False, (
                "Missing Python packages: "
                + ", ".join(missing)
                + ". Install the optional 'musicgen' extras for the local service."
            )
        return True, None

    def generate_batch(
        self,
        request: GenerationRequest,
        count: int,
        progress: ProgressCallback,
        cancelled: CancelCheck,
    ) -> list[AudioResult]:
        available, detail = self.availability()
        if not available:
            raise DependencyMissing("MusicGen runtime", detail or "The model is not ready.")
        import torch  # type: ignore
        from transformers import AutoProcessor, MusicgenForConditionalGeneration  # type: ignore

        _check_cancel(cancelled)
        progress(0.05, "Loading MusicGen model")
        dtype = torch.float16 if self.device == "cuda" else torch.float32
        model = None
        try:
            processor = AutoProcessor.from_pretrained(self.install_path, local_files_only=True)
            model = MusicgenForConditionalGeneration.from_pretrained(
                self.install_path, local_files_only=True, torch_dtype=dtype
            )
            model.to(self.device)
            model.eval()
            _check_cancel(cancelled)
            progress(None, "Generating music (model does not expose step progress)")
            inputs = processor(
                text=[request.prompt] * count,
                padding=True,
                return_tensors="pt",
            ).to(self.device)
            seed = _seed_for(request, 0)
            torch.manual_seed(seed)
            if self.device == "cuda":
                torch.cuda.manual_seed_all(seed)
            max_tokens = int(max(1.0, min(request.duration, 30.0)) * 50)
            with torch.no_grad():
                generated = model.generate(
                    **inputs,
                    do_sample=True,
                    guidance_scale=float(request.params.guidance or 3.0),
                    max_new_tokens=max_tokens,
                    num_return_sequences=count,
                )
            _check_cancel(cancelled)
            sample_rate = int(getattr(model.config, "audio_enc_sample_rate", 32000) or 32000)
            results: list[AudioResult] = []
            for index in range(generated.shape[0]):
                audio = generated[index, 0].detach().to("cpu").float().numpy()
                audio = _postprocess(audio, sample_rate, request)
                results.append(AudioResult(audio=audio, sample_rate=sample_rate, indeterminate=True))
            progress(0.98, "Finalizing generated audio")
            return results
        except GenerationCancelled:
            raise
        except RuntimeError as exc:
            text = str(exc).lower()
            if "out of memory" in text or "cuda error" in text and "memory" in text:
                raise OutOfMemory(
                    self.device,
                    "The model ran out of memory while generating audio.",
                ) from exc
            raise ApiError(
                "generation_failed",
                "MusicGen failed while generating audio.",
                status_code=500,
                details={"backend": self.device},
            ) from exc
        finally:
            if model is not None:
                del model
            gc.collect()
            if self.device == "cuda":
                try:
                    import torch  # type: ignore

                    torch.cuda.empty_cache()
                except Exception:
                    pass


class StableAudioAdapter(Adapter):
    def availability(self) -> tuple[bool, str | None]:
        if not self.install_path:
            return False, "Model files are not installed."
        missing = missing_dependencies(["torch", "diffusers", "transformers"])
        if missing:
            return False, (
                "Missing Python packages: "
                + ", ".join(missing)
                + ". Install the optional 'stable-audio' extras for the local service."
            )
        return True, None

    def generate_batch(
        self,
        request: GenerationRequest,
        count: int,
        progress: ProgressCallback,
        cancelled: CancelCheck,
    ) -> list[AudioResult]:
        available, detail = self.availability()
        if not available:
            raise DependencyMissing("Stable Audio runtime", detail or "The model is not ready.")
        import torch  # type: ignore
        from diffusers import StableAudioPipeline  # type: ignore

        _check_cancel(cancelled)
        progress(0.05, "Loading Stable Audio model")
        pipe = None
        dtype = torch.float16 if self.device == "cuda" else torch.float32
        try:
            pipe = StableAudioPipeline.from_pretrained(
                self.install_path, local_files_only=True, torch_dtype=dtype
            )
            pipe = pipe.to(self.device)
            pipe.set_progress_bar_config(disable=True)
            steps = int(request.params.steps or (50 if request.params.quality == "fast" else 100))
            steps = max(1, min(steps, 300))
            seed = _seed_for(request, 0)
            generator = torch.Generator(device=self.device).manual_seed(seed)

            def callback(_pipe: object, step: int, _timestep: object, kwargs: dict) -> dict:
                _check_cancel(cancelled)
                progress(0.12 + 0.8 * (step / steps), f"Diffusion step {step}/{steps}")
                return kwargs

            progress(0.1, "Starting diffusion")
            audio = pipe(
                prompt=[request.prompt] * count,
                negative_prompt=[request.negative_prompt or ""] * count,
                num_inference_steps=steps,
                audio_end_in_s=float(max(1.0, min(request.duration, 47.0))),
                num_waveforms_per_prompt=count,
                guidance_scale=float(request.params.guidance or 7.0),
                generator=generator,
                callback_on_step_end=callback,
            ).audios
            _check_cancel(cancelled)
            sample_rate = int(getattr(pipe.vae, "sampling_rate", 44100) or 44100)
            results: list[AudioResult] = []
            for index in range(audio.shape[0]):
                waveform = audio[index].detach().to("cpu").float().numpy()
                if waveform.ndim == 1:
                    waveform = waveform[:, None]
                waveform = _postprocess(
                    waveform,
                    sample_rate,
                    request,
                    loop=bool(request.params.loop and request.params.loop),
                )
                results.append(AudioResult(audio=waveform, sample_rate=sample_rate))
            progress(0.98, "Finalizing generated audio")
            return results
        except GenerationCancelled:
            raise
        except RuntimeError as exc:
            text = str(exc).lower()
            if "out of memory" in text:
                raise OutOfMemory(self.device, "Stable Audio ran out of memory.") from exc
            raise ApiError(
                "generation_failed",
                "Stable Audio failed while generating audio.",
                status_code=500,
                details={"backend": self.device},
            ) from exc
        finally:
            if pipe is not None:
                del pipe
            gc.collect()
            if self.device == "cuda":
                try:
                    import torch  # type: ignore

                    torch.cuda.empty_cache()
                except Exception:
                    pass


ADAPTERS = {
    "procedural": ProceduralAdapter,
    "musicgen": MusicGenAdapter,
    "stable-audio": StableAudioAdapter,
}


def build_adapter(
    definition: ModelDefinition, install_path: str | None, device: str
) -> Adapter:
    adapter_class = ADAPTERS.get(definition.adapter)
    if not adapter_class:
        raise ApiError(
            "adapter_unavailable",
            "This model has no installed generation adapter.",
            status_code=409,
            details={"adapter": definition.adapter},
        )
    return adapter_class(definition, install_path, device)
