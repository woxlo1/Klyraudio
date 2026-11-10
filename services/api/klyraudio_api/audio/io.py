"""Audio file probing, decoding, resampling, and writing.

All decoding goes through libsndfile first and FFmpeg second. FFmpeg is always
invoked with an argument list (never a shell) and a bounded timeout.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any, Dict, Optional

import numpy as np
import soundfile as sf

from ..config import SUPPORTED_IMPORT_EXTENSIONS
from ..errors import ApiError, DependencyMissing, ValidationFailed


class AudioDecodeError(ApiError):
    def __init__(self, message: str, path: Optional[Path] = None) -> None:
        super().__init__(
            "audio_decode_failed",
            message,
            status_code=422,
            details={"path": str(path) if path else None},
            remediation="Verify the file is a valid, uncorrupted audio file and try importing again.",
        )


def ffmpeg_version(ffmpeg: Optional[str]) -> Optional[str]:
    if not ffmpeg:
        return None
    try:
        result = subprocess.run(
            [ffmpeg, "-version"],
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    first = (result.stdout or "").splitlines()
    if not first:
        return None
    return first[0].strip()


def _run_ffmpeg(args: list[str], timeout: int = 300) -> subprocess.CompletedProcess:
    try:
        result = subprocess.run(args, capture_output=True, timeout=timeout, check=False)
    except FileNotFoundError as exc:
        raise DependencyMissing(
            "FFmpeg",
            "Install FFmpeg and add it to PATH, or set KLYRAUDIO_FFMPEG to the executable path.",
        ) from exc
    except subprocess.TimeoutExpired as exc:
        raise ApiError(
            "audio_processing_timeout",
            "FFmpeg did not finish within the allowed time.",
            status_code=504,
        ) from exc
    if result.returncode != 0:
        stderr = (result.stderr or b"").decode("utf-8", "replace")[-2000:]
        raise AudioDecodeError(f"FFmpeg could not process the audio. {stderr}")
    return result


def validate_extension(path: Path) -> None:
    if path.suffix.lower() not in SUPPORTED_IMPORT_EXTENSIONS:
        raise ValidationFailed(
            "Unsupported audio file extension.",
            {"extension": path.suffix, "supported": sorted(SUPPORTED_IMPORT_EXTENSIONS)},
        )


def probe(path: Path, ffprobe: Optional[str] = None) -> Dict[str, Any]:
    """Return duration, sample rate, channels, format, and frames for an audio file."""
    validate_extension(path)
    if not path.is_file():
        raise AudioDecodeError("The audio file does not exist.", path)

    try:
        info = sf.info(str(path))
        if info.frames > 0 and info.samplerate > 0 and info.channels > 0:
            return {
                "duration": float(info.frames / info.samplerate),
                "sample_rate": int(info.samplerate),
                "channels": int(info.channels),
                "format": info.format.lower(),
                "frames": int(info.frames),
                "subtype": info.subtype,
            }
    except Exception:
        pass

    if not ffprobe:
        raise AudioDecodeError(
            "The file could not be read and FFprobe is not installed for fallback decoding.",
            path,
        )
    result = _run_ffprobe(ffprobe, path)
    streams = [s for s in result.get("streams", []) if s.get("codec_type") == "audio"]
    if not streams:
        raise AudioDecodeError("The file has no decodable audio stream.", path)
    stream = streams[0]
    duration = result.get("format", {}).get("duration") or stream.get("duration")
    try:
        duration_value = float(duration)
    except (TypeError, ValueError):
        duration_value = 0.0
    return {
        "duration": duration_value,
        "sample_rate": int(stream.get("sample_rate") or 44100),
        "channels": int(stream.get("channels") or 2),
        "format": (result.get("format", {}).get("format_name") or "unknown").lower(),
        "frames": int(duration_value * int(stream.get("sample_rate") or 44100)),
        "subtype": stream.get("codec_name"),
    }


def _run_ffprobe(ffprobe: str, path: Path) -> Dict[str, Any]:
    try:
        result = subprocess.run(
            [
                ffprobe,
                "-v",
                "error",
                "-show_streams",
                "-show_format",
                "-of",
                "json",
                str(path),
            ],
            capture_output=True,
            timeout=30,
            check=False,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        raise AudioDecodeError("FFprobe could not inspect the file.", path) from exc
    if result.returncode != 0:
        raise AudioDecodeError("The file is not a readable audio file.", path)
    try:
        return json.loads(result.stdout.decode("utf-8", "replace"))
    except ValueError as exc:
        raise AudioDecodeError("FFprobe returned unreadable metadata.", path) from exc


def load(
    path: Path,
    *,
    target_sr: Optional[int] = None,
    mono: bool = False,
    ffmpeg: Optional[str] = None,
) -> np.ndarray:
    """Load audio as float32 with shape ``(frames, channels)``."""
    try:
        data, sample_rate = sf.read(str(path), always_2d=True, dtype="float32")
    except Exception:
        data, sample_rate = _decode_with_ffmpeg(path, ffmpeg)
    data = np.asarray(data, dtype=np.float32)
    if data.ndim == 1:
        data = data[:, None]
    if mono and data.shape[1] > 1:
        data = data.mean(axis=1, keepdims=True)
    if target_sr and int(sample_rate) != int(target_sr):
        data = _resample_ffmpeg(data, int(sample_rate), int(target_sr), ffmpeg)
    return np.nan_to_num(data, nan=0.0, posinf=0.0, neginf=0.0)


def _decode_with_ffmpeg(path: Path, ffmpeg: Optional[str]) -> tuple[np.ndarray, int]:
    if not ffmpeg:
        raise AudioDecodeError(
            "This format requires FFmpeg, which was not found.",
            path,
        )
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        tmp_path = Path(tmp.name)
    try:
        _run_ffmpeg(
            [
                ffmpeg,
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-i",
                str(path),
                "-acodec",
                "pcm_f32le",
                "-f",
                "wav",
                str(tmp_path),
            ]
        )
        data, sample_rate = sf.read(str(tmp_path), always_2d=True, dtype="float32")
        return np.asarray(data, dtype=np.float32), int(sample_rate)
    finally:
        tmp_path.unlink(missing_ok=True)


def _resample_ffmpeg(
    data: np.ndarray, source_sr: int, target_sr: int, ffmpeg: Optional[str]
) -> np.ndarray:
    if source_sr == target_sr:
        return data
    if not ffmpeg:
        raise DependencyMissing(
            "FFmpeg",
            "Sample-rate conversion requires FFmpeg. Install FFmpeg or generate audio at the "
            "project sample rate.",
        )
    channels = data.shape[1]
    args = [
        ffmpeg,
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "f32le",
        "-ar",
        str(source_sr),
        "-ac",
        str(channels),
        "-i",
        "pipe:0",
        "-f",
        "f32le",
        "-ar",
        str(target_sr),
        "-ac",
        str(channels),
        "pipe:1",
    ]
    try:
        result = subprocess.run(
            args,
            input=data.astype(np.float32).tobytes(),
            capture_output=True,
            timeout=300,
            check=False,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        raise DependencyMissing("FFmpeg", "FFmpeg is required for sample-rate conversion.") from exc
    if result.returncode != 0:
        raise AudioDecodeError("FFmpeg failed to convert the sample rate.")
    output = np.frombuffer(result.stdout, dtype=np.float32)
    if output.size == 0:
        raise AudioDecodeError("FFmpeg returned empty audio during sample-rate conversion.")
    return output.reshape(-1, channels)


def write(
    path: Path,
    data: np.ndarray,
    sample_rate: int,
    *,
    subtype: str = "PCM_24",
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if data.ndim == 1:
        data = data[:, None]
    np.clip(data, -1.0, 1.0, out=data)
    sf.write(str(path), data, int(sample_rate), subtype=subtype, format="WAV")


def write_encoded(
    path: Path,
    data: np.ndarray,
    sample_rate: int,
    *,
    fmt: str,
    ffmpeg: Optional[str] = None,
) -> None:
    fmt = fmt.lower()
    if fmt in {"wav", "flac", "aiff"}:
        subtype = "PCM_16"
        sf_format = {"wav": "WAV", "flac": "FLAC", "aiff": "AIFF"}[fmt]
        path.parent.mkdir(parents=True, exist_ok=True)
        with sf.SoundFile(
            str(path), mode="w", samplerate=sample_rate, channels=data.shape[1],
            subtype=subtype, format=sf_format
        ) as handle:
            handle.write(np.clip(data, -1.0, 1.0))
        return
    if not ffmpeg:
        raise DependencyMissing("FFmpeg", f"Exporting {fmt.upper()} requires FFmpeg.")
    with tempfile.TemporaryDirectory() as tmpdir:
        temp_wav = Path(tmpdir) / "source.wav"
        write(temp_wav, data, sample_rate)
        _run_ffmpeg(
            [
                ffmpeg,
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-i",
                str(temp_wav),
                str(path),
            ]
        )


def to_wav(src: Path, dest: Path, *, sample_rate: int, ffmpeg: Optional[str] = None) -> None:
    data = load(src, target_sr=sample_rate, ffmpeg=ffmpeg)
    write(dest, data, sample_rate)


def copy_import(src: Path, dest_dir: Path) -> Path:
    """Copy an upload into the managed imports directory without trusting its name."""
    dest_dir.mkdir(parents=True, exist_ok=True)
    safe_name = src.name.replace("\\", "_").replace("/", "_")
    target = dest_dir / safe_name
    if target.resolve() == src.resolve():
        return target
    shutil.copy2(src, target)
    return target
