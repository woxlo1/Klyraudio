"""Application configuration and filesystem layout for the local Klyraudio service."""

from __future__ import annotations

import json
import os
import platform
import re
import threading
from pathlib import Path
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field, field_validator

APP_NAME = "Klyraudio"
APP_VERSION = "0.1.0"
PROJECT_FORMAT_VERSION = 1

_TRUE_VALUES = {"1", "true", "yes", "on"}


def _env_flag(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in _TRUE_VALUES


def default_data_dir() -> Path:
    override = os.environ.get("KLYRAUDIO_DATA_DIR")
    if override:
        return Path(override).expanduser().resolve()
    home = Path.home()
    system = platform.system()
    if system == "Windows":
        base = Path(os.environ.get("LOCALAPPDATA", home / "AppData" / "Local"))
        return base / APP_NAME
    if system == "Darwin":
        return home / "Library" / "Application Support" / APP_NAME
    return Path(os.environ.get("XDG_DATA_HOME", home / ".local" / "share")) / "klyraudio"


class RuntimeSettings(BaseModel):
    """User-editable settings persisted to ``config.json``."""

    language: str = "en"
    theme: str = "dark"
    default_export_format: str = "wav"
    default_sample_rate: int = 44100
    max_concurrent_jobs: int = 1
    gpu_preference: str = "auto"
    onboarding_complete: bool = False
    default_project_dir: Optional[str] = None
    model_license_acknowledgements: Dict[str, str] = Field(default_factory=dict)
    reduce_motion: bool = False
    telemetry: bool = False
    last_seen_version: Optional[str] = None

    @field_validator("language")
    @classmethod
    def _language(cls, value: str) -> str:
        if value not in {"en", "ja"}:
            raise ValueError("language must be 'en' or 'ja'")
        return value

    @field_validator("theme")
    @classmethod
    def _theme(cls, value: str) -> str:
        if value not in {"dark", "light", "system"}:
            raise ValueError("theme must be dark, light, or system")
        return value

    @field_validator("gpu_preference")
    @classmethod
    def _gpu_preference(cls, value: str) -> str:
        if value not in {"auto", "cuda", "mps", "cpu"}:
            raise ValueError("gpu_preference must be auto, cuda, mps, or cpu")
        return value

    @field_validator("max_concurrent_jobs")
    @classmethod
    def _concurrency(cls, value: int) -> int:
        if not 1 <= value <= 4:
            raise ValueError("max_concurrent_jobs must be between 1 and 4")
        return value

    @field_validator("default_sample_rate")
    @classmethod
    def _sample_rate(cls, value: int) -> int:
        if value not in {22050, 32000, 44100, 48000, 96000}:
            raise ValueError("unsupported default sample rate")
        return value

    @field_validator("telemetry")
    @classmethod
    def _telemetry(cls, value: bool) -> bool:
        if value:
            raise ValueError("Klyraudio does not implement telemetry; this flag cannot be enabled")
        return value


class Paths:
    """Every filesystem location the service is allowed to read or write."""

    def __init__(self, data_dir: Path) -> None:
        self.data_dir = data_dir.resolve()
        self.media = self.data_dir / "media"
        self.imports = self.data_dir / "imports"
        self.exports = self.data_dir / "exports"
        self.projects = self.data_dir / "projects"
        self.models = self.data_dir / "models"
        self.cache = self.data_dir / "cache"
        self.waveforms = self.cache / "waveforms"
        self.logs = self.data_dir / "logs"
        self.tmp = self.cache / "tmp"
        self.database = self.data_dir / "klyraudio.sqlite3"
        self.config = self.data_dir / "config.json"

    def ensure(self) -> None:
        for path in (
            self.data_dir,
            self.media,
            self.imports,
            self.exports,
            self.projects,
            self.models,
            self.cache,
            self.waveforms,
            self.logs,
            self.tmp,
        ):
            path.mkdir(parents=True, exist_ok=True)

    def allowed_roots(self) -> List[Path]:
        return [
            self.media,
            self.imports,
            self.exports,
            self.projects,
            self.models,
            self.cache,
        ]

    def relative_to_data(self, path: Path) -> str:
        return path.resolve().relative_to(self.data_dir).as_posix()


class ConfigStore:
    """Thread-safe JSON configuration store with atomic writes."""

    def __init__(self, paths: Paths) -> None:
        self._paths = paths
        self._lock = threading.RLock()
        self._settings = self._load()

    def _load(self) -> RuntimeSettings:
        if not self._paths.config.exists():
            settings = RuntimeSettings()
            self._settings = settings
            self._write(settings)
            return settings
        try:
            raw = json.loads(self._paths.config.read_text(encoding="utf-8"))
            return RuntimeSettings(**raw)
        except (OSError, ValueError, TypeError):
            # A corrupt config must never prevent the application from starting.
            broken = self._paths.config.with_suffix(".broken.json")
            try:
                self._paths.config.replace(broken)
            except OSError:
                pass
            settings = RuntimeSettings()
            self._write(settings)
            return settings

    def _write(self, settings: RuntimeSettings) -> None:
        tmp = self._paths.config.with_suffix(".tmp")
        tmp.write_text(
            json.dumps(settings.model_dump(), ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        tmp.replace(self._paths.config)

    @property
    def settings(self) -> RuntimeSettings:
        with self._lock:
            return self._settings.model_copy(deep=True)

    def update(self, **changes: Any) -> RuntimeSettings:
        with self._lock:
            payload = self._settings.model_dump()
            payload.update(changes)
            updated = RuntimeSettings(**payload)
            self._write(updated)
            self._settings = updated
            return updated.model_copy(deep=True)


def sanitize_filename(name: str, fallback: str = "audio") -> str:
    """Return a safe file name component without directory traversal characters."""
    cleaned = name.replace("\\", "/").split("/")[-1].strip()
    cleaned = re.sub(r"[\x00-\x1f<>:\"|?*]", "", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip(" .")
    if not cleaned or cleaned in {".", ".."}:
        cleaned = fallback
    if len(cleaned) > 120:
        stem, dot, suffix = cleaned.rpartition(".")
        if dot and len(suffix) <= 8:
            cleaned = stem[: 120 - len(suffix) - 1] + "." + suffix
        else:
            cleaned = cleaned[:120]
    return cleaned


# Extensions that may be imported or decoded. Extensions are hints only; FFmpeg or
# libsndfile performs the real decoding and validation.
SUPPORTED_IMPORT_EXTENSIONS = {
    ".wav",
    ".wave",
    ".flac",
    ".mp3",
    ".ogg",
    ".oga",
    ".opus",
    ".m4a",
    ".aac",
    ".aiff",
    ".aif",
    ".aifc",
    ".caf",
    ".webm",
}


def find_ffmpeg() -> Optional[str]:
    """Locate FFmpeg without executing anything from an untrusted location."""
    override = os.environ.get("KLYRAUDIO_FFMPEG")
    if override and Path(override).is_file():
        return str(Path(override))
    from shutil import which

    found = which("ffmpeg")
    if found:
        return found
    if platform.system() == "Windows":
        candidates = [
            Path(os.environ.get("ProgramFiles", "C:/Program Files")) / "ffmpeg" / "bin" / "ffmpeg.exe",
            Path(os.environ.get("LOCALAPPDATA", "")) / "Microsoft" / "WinGet" / "Links" / "ffmpeg.exe",
        ]
        for candidate in candidates:
            if candidate.is_file():
                return str(candidate)
    return None


class ServiceContext:
    """Dependency container shared by routers and services."""

    def __init__(self, data_dir: Optional[Path] = None) -> None:
        self.paths = Paths(data_dir or default_data_dir())
        self.paths.ensure()
        self.config = ConfigStore(self.paths)
        self.ffmpeg_path = find_ffmpeg()
        self.ffprobe_path = self._find_ffprobe(self.ffmpeg_path)
        self.started_at = 0.0
        self.request_id = ""

    @staticmethod
    def _find_ffprobe(ffmpeg_path: Optional[str]) -> Optional[str]:
        override = os.environ.get("KLYRAUDIO_FFPROBE")
        if override and Path(override).is_file():
            return str(Path(override))
        if ffmpeg_path:
            candidate = Path(ffmpeg_path).with_name(
                "ffprobe.exe" if platform.system() == "Windows" else "ffprobe"
            )
            if candidate.is_file():
                return str(candidate)
        from shutil import which

        return which("ffprobe")

    def describe(self) -> Dict[str, Any]:
        return {
            "version": APP_VERSION,
            "data_dir": str(self.paths.data_dir),
            "ffmpeg": self.ffmpeg_path,
            "ffprobe": self.ffprobe_path,
            "python": platform.python_version(),
        }


def is_loopback_host(host: str) -> bool:
    normalized = host.strip().lower().strip("[]")
    return normalized in {"127.0.0.1", "localhost", "::1"}


def allow_lan() -> bool:
    """LAN exposure is opt-in and never enabled by default."""
    return _env_flag("KLYRAUDIO_ALLOW_LAN", False)
