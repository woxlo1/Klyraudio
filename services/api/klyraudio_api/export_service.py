"""Verified audio export through libsndfile and FFmpeg."""

from __future__ import annotations

import re
import shutil
import subprocess
import tempfile
import time
import uuid
from pathlib import Path
from typing import Dict, List, Optional

import numpy as np
import soundfile as sf

from .audio import dsp, io
from .assets_service import AssetService
from .config import ServiceContext, sanitize_filename
from .errors import ApiError, DependencyMissing, NotFound, ValidationFailed
from .repositories import ExportRepository, now_iso
from .schemas import (
    ExportCapabilities,
    ExportFormatOption,
    ExportRequest,
    ExportResult,
)

BUILTIN_FORMATS = {
    "wav": ("WAV", {"16": "PCM_16", "24": "PCM_24", "32": "FLOAT"}),
    "flac": ("FLAC", {"16": "PCM_16", "24": "PCM_24"}),
    "aiff": ("AIFF", {"16": "PCM_16", "24": "PCM_24"}),
}
LOSSY_FORMATS = {
    "mp3": ("mp3", "libmp3lame", "mp3", 192),
    "ogg": ("ogg", "libvorbis", "ogg", 192),
    "opus": ("opus", "libopus", "opus", 128),
    "m4a": ("m4a", "aac", "mp4", 192),
    "aac": ("aac", "aac", "adts", 192),
}
ALLOWED_SAMPLE_RATES = {22050, 32000, 44100, 48000, 96000}
_encoder_cache: Dict[str, object] = {"at": 0.0, "encoders": set(), "version": None}


def _ffmpeg_encoders(ffmpeg: Optional[str]) -> tuple[set, Optional[str]]:
    if not ffmpeg:
        return set(), None
    now = time.monotonic()
    if _encoder_cache["encoders"] and now - float(_encoder_cache["at"]) < 60:
        return _encoder_cache["encoders"], _encoder_cache["version"]  # type: ignore[return-value]
    try:
        result = subprocess.run(
            [ffmpeg, "-hide_banner", "-encoders"],
            capture_output=True,
            text=True,
            timeout=20,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return set(), None
    encoders = set()
    version = None
    for line in (result.stdout or "").splitlines():
        if line.startswith("ffmpeg version") or line.startswith("ffmpeg"):
            version = line.strip()
            continue
        match = re.match(r"^\s*[A-Z.]{1,8}\s+([A-Za-z0-9_]+)", line)
        if match:
            encoders.add(match.group(1))
    _encoder_cache.update({"at": now, "encoders": encoders, "version": version})
    return encoders, version


class ExportService:
    def __init__(
        self, context: ServiceContext, assets: AssetService, exports: ExportRepository
    ) -> None:
        self.context = context
        self.assets = assets
        self.exports = exports

    def capabilities(self) -> ExportCapabilities:
        encoders, version = _ffmpeg_encoders(self.context.ffmpeg_path)
        options: List[ExportFormatOption] = [
            ExportFormatOption(
                id="wav",
                label="WAV",
                container="WAV (RIFF)",
                codecs=["PCM 16-bit", "PCM 24-bit", "32-bit float"],
                supports_bitrate=False,
                supports_bit_depth=True,
                supports_sample_rate=True,
                available=True,
                extension="wav",
            ),
            ExportFormatOption(
                id="flac",
                label="FLAC",
                container="FLAC",
                codecs=["FLAC lossless"],
                supports_bitrate=False,
                supports_bit_depth=True,
                supports_sample_rate=True,
                available=True,
                extension="flac",
            ),
            ExportFormatOption(
                id="aiff",
                label="AIFF",
                container="AIFF",
                codecs=["PCM 16-bit", "PCM 24-bit"],
                supports_bitrate=False,
                supports_bit_depth=True,
                supports_sample_rate=True,
                available=True,
                extension="aiff",
            ),
        ]
        for format_id, (extension, encoder, container, _default) in LOSSY_FORMATS.items():
            available = encoder in encoders
            reason = None
            if not self.context.ffmpeg_path:
                reason = (
                    "FFmpeg is not installed. Install FFmpeg and restart Klyraudio to enable "
                    "this format."
                )
            elif not available:
                reason = f"The installed FFmpeg build does not include the {encoder} encoder."
            options.append(
                ExportFormatOption(
                    id=format_id,
                    label=format_id.upper(),
                    container=container,
                    codecs=[encoder],
                    supports_bitrate=True,
                    supports_bit_depth=False,
                    supports_sample_rate=True,
                    available=available,
                    reason=reason,
                    extension=extension,
                )
            )
        return ExportCapabilities(
            ffmpeg_available=bool(self.context.ffmpeg_path),
            ffmpeg_version=version or io.ffmpeg_version(self.context.ffmpeg_path),
            formats=options,
            encoders=sorted(encoders),
        )

    def export(self, request: ExportRequest) -> ExportResult:
        capabilities = self.capabilities()
        option = next((f for f in capabilities.formats if f.id == request.format), None)
        if not option:
            raise NotFound("Export format", request.format)
        if not option.available:
            raise DependencyMissing(
                option.label,
                option.reason or "The required encoder is not available.",
            )
        asset = self.assets.get(request.asset_id)
        source = self.assets.file_path(asset)
        sample_rate = int(request.sample_rate or asset["sample_rate"])
        if sample_rate not in ALLOWED_SAMPLE_RATES:
            raise ValidationFailed(
                "Unsupported export sample rate.",
                {"supported": sorted(ALLOWED_SAMPLE_RATES)},
            )
        channels = int(request.channels or asset["channels"])
        if channels not in {1, 2}:
            raise ValidationFailed("Export channels must be mono or stereo.")
        audio = io.load(source, target_sr=sample_rate, ffmpeg=self.context.ffmpeg_path)
        audio = _convert_channels(audio, channels)
        if request.normalize_peak_db is not None:
            audio = dsp.normalize(audio, request.normalize_peak_db)

        if option.supports_bit_depth:
            bit_depth = int(request.bit_depth or 24)
            if request.format in BUILTIN_FORMATS and str(bit_depth) not in BUILTIN_FORMATS[request.format][1]:
                raise ValidationFailed(
                    f"{option.label} does not support {bit_depth}-bit export in Klyraudio.",
                    {"supported": sorted(BUILTIN_FORMATS[request.format][1].keys(), key=int)},
                )
            if request.dither and bit_depth == 16:
                audio = _dither(audio)
        else:
            bit_depth = 0

        extension = option.extension
        base = request.filename or f"{asset['name']}"
        base = sanitize_filename(base)
        if not base.lower().endswith(f".{extension}"):
            base = f"{base}.{extension}"
        target = _unique_path(self.context.paths.exports, base)
        settings = {
            "sample_rate": sample_rate,
            "channels": channels,
            "bit_depth": bit_depth or None,
            "bitrate_kbps": request.bitrate_kbps,
            "dither": request.dither,
            "normalize_peak_db": request.normalize_peak_db,
        }
        message_bits = []
        try:
            if request.format in BUILTIN_FORMATS:
                sf_format, subtypes = BUILTIN_FORMATS[request.format]
                subtype = subtypes[str(bit_depth)]
                target.parent.mkdir(parents=True, exist_ok=True)
                sf.write(str(target), np.clip(audio, -1.0, 1.0), sample_rate, subtype=subtype, format=sf_format)
                codec_label = subtype
            else:
                _default_extension, encoder, container, default_bitrate = LOSSY_FORMATS[request.format]
                bitrate = int(request.bitrate_kbps or default_bitrate)
                if not 32 <= bitrate <= 512:
                    raise ValidationFailed("Bitrate must be between 32 and 512 kbps.")
                codec_label = f"{encoder} {bitrate} kbps"
                with tempfile.TemporaryDirectory(dir=self.context.paths.tmp) as tmpdir:
                    temp_wav = Path(tmpdir) / "export-source.wav"
                    io.write(temp_wav, audio, sample_rate, subtype="PCM_24")
                    args = [
                        self.context.ffmpeg_path or "ffmpeg",
                        "-hide_banner",
                        "-loglevel",
                        "error",
                        "-y",
                        "-i",
                        str(temp_wav),
                        "-ar",
                        str(sample_rate),
                        "-ac",
                        str(channels),
                        "-c:a",
                        encoder,
                        "-b:a",
                        f"{bitrate}k",
                    ]
                    if request.format == "m4a":
                        args += ["-movflags", "+faststart"]
                    if request.format == "aac":
                        args += ["-f", "adts"]
                    args.append(str(target))
                    result = subprocess.run(args, capture_output=True, timeout=600, check=False)
                    if result.returncode != 0:
                        stderr = (result.stderr or b"").decode("utf-8", "replace")[-1500:]
                        raise ApiError(
                            "export_failed",
                            "FFmpeg could not encode the export.",
                            status_code=500,
                            details={"stderr": stderr},
                        )
                settings["bitrate_kbps"] = bitrate
            message_bits.append(codec_label)
            message_bits.append(f"{sample_rate / 1000:g} kHz")
            message_bits.append("mono" if channels == 1 else "stereo")
            if request.normalize_peak_db is not None:
                message_bits.append(f"peak normalized to {request.normalize_peak_db:g} dBFS")
            if request.dither and bit_depth == 16:
                message_bits.append("TPDF dither")
            verified = self._verify(target, asset, audio.shape[0], sample_rate)
            record_id = f"ex_{uuid.uuid4().hex[:16]}"
            self.exports.create(
                {
                    "id": record_id,
                    "asset_id": request.asset_id,
                    "format": request.format,
                    "path": str(target),
                    "settings": settings,
                    "size_bytes": target.stat().st_size,
                    "created_at": now_iso(),
                    "verified": verified,
                }
            )
            return ExportResult(
                id=record_id,
                format=request.format,
                path=str(target),
                size_bytes=target.stat().st_size,
                verified=verified,
                duration=float(asset["duration"]),
                message=(
                    f"Exported {option.label} ({', '.join(message_bits)}). "
                    + ("The file was reopened and validated." if verified else "Verification was unavailable.")
                ),
            )
        except Exception:
            target.unlink(missing_ok=True)
            raise

    def _verify(self, path: Path, asset: Dict[str, object], frames: int, sample_rate: int) -> bool:
        if not path.is_file() or path.stat().st_size == 0:
            raise ApiError("export_verification_failed", "The exported file is empty.", status_code=500)
        try:
            info = io.probe(path, self.context.ffprobe_path)
        except Exception as exc:
            raise ApiError(
                "export_verification_failed",
                "The exported file could not be reopened for verification.",
                status_code=500,
                remediation="Try a different format or reinstall FFmpeg.",
            ) from exc
        expected = frames / sample_rate
        tolerance = max(0.35, expected * 0.02)
        if info["duration"] <= 0 or abs(float(info["duration"]) - expected) > tolerance:
            raise ApiError(
                "export_verification_failed",
                "The exported file's duration did not match the audio that was written.",
                status_code=500,
                details={"expected_seconds": expected, "actual_seconds": info["duration"]},
            )
        return True

    def history(self, limit: int = 50) -> List[Dict[str, object]]:
        return self.exports.list(limit)

    def exports_dir(self) -> str:
        return str(self.context.paths.exports)


def _convert_channels(audio: np.ndarray, channels: int) -> np.ndarray:
    data = dsp.as_2d(audio)
    if data.shape[1] == channels:
        return data
    if channels == 1 and data.shape[1] > 1:
        return data.mean(axis=1, keepdims=True)
    if channels == 2 and data.shape[1] == 1:
        return np.repeat(data, 2, axis=1)
    return data[:, :channels]


def _dither(audio: np.ndarray) -> np.ndarray:
    generator = np.random.default_rng()
    noise = generator.uniform(-0.5, 0.5, size=audio.shape).astype(np.float32)
    noise += generator.uniform(-0.5, 0.5, size=audio.shape).astype(np.float32)
    return (audio + noise / 32768.0).astype(np.float32)


def _unique_path(directory: Path, filename: str) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    candidate = directory / filename
    if not candidate.exists():
        return candidate
    stem = candidate.stem
    suffix = candidate.suffix
    for index in range(2, 1000):
        alternative = directory / f"{stem} ({index}){suffix}"
        if not alternative.exists():
            return alternative
    return directory / f"{stem}-{uuid.uuid4().hex[:6]}{suffix}"
