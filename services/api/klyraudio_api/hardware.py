"""Cross-platform hardware detection with honest fallbacks.

GPU detection uses vendor tools when present. Nothing here requires PyTorch, so
the application can report hardware before optional AI dependencies exist.
"""

from __future__ import annotations

import ctypes
import json
import os
import platform
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

from .schemas import GpuInfo, SystemInfo


def _run(command: List[str], timeout: int = 15) -> Optional[str]:
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=timeout, check=False)
    except (OSError, subprocess.SubprocessError):
        return None
    if result.returncode != 0:
        return None
    return result.stdout or ""


def _cpu_model() -> str:
    system = platform.system()
    if system == "Windows":
        value = platform.processor()
        if value:
            return value
        try:
            import winreg

            key = winreg.OpenKey(
                winreg.HKEY_LOCAL_MACHINE,
                r"HARDWARE\DESCRIPTION\System\CentralProcessor\0",
            )
            name, _ = winreg.QueryValueEx(key, "ProcessorNameString")
            return str(name).strip()
        except OSError:
            return "Unknown CPU"
    if system == "Darwin":
        return (_run(["sysctl", "-n", "machdep.cpu.brand_string"]) or "Apple Silicon").strip()
    try:
        for line in Path("/proc/cpuinfo").read_text(encoding="utf-8").splitlines():
            if line.lower().startswith("model name"):
                return line.split(":", 1)[1].strip()
    except OSError:
        pass
    return platform.processor() or "Unknown CPU"


def _memory_mb() -> tuple[Optional[int], Optional[int]]:
    try:
        import psutil  # type: ignore

        memory = psutil.virtual_memory()
        return int(memory.total / (1024 * 1024)), int(memory.available / (1024 * 1024))
    except Exception:
        pass

    system = platform.system()
    if system == "Windows":
        class MEMORYSTATUSEX(ctypes.Structure):
            _fields_ = [
                ("dwLength", ctypes.c_ulong),
                ("dwMemoryLoad", ctypes.c_ulong),
                ("ullTotalPhys", ctypes.c_ulonglong),
                ("ullAvailPhys", ctypes.c_ulonglong),
                ("ullTotalPageFile", ctypes.c_ulonglong),
                ("ullAvailPageFile", ctypes.c_ulonglong),
                ("ullTotalVirtual", ctypes.c_ulonglong),
                ("ullAvailVirtual", ctypes.c_ulonglong),
                ("ullAvailExtendedVirtual", ctypes.c_ulonglong),
            ]

        status = MEMORYSTATUSEX()
        status.dwLength = ctypes.sizeof(status)
        if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status)):
            return (
                int(status.ullTotalPhys / (1024 * 1024)),
                int(status.ullAvailPhys / (1024 * 1024)),
            )
    if system == "Darwin":
        total = _run(["sysctl", "-n", "hw.memsize"])
        if total and total.strip().isdigit():
            return int(int(total.strip()) / (1024 * 1024)), None
    try:
        lines = Path("/proc/meminfo").read_text(encoding="utf-8").splitlines()
        values: Dict[str, int] = {}
        for line in lines:
            key, _, rest = line.partition(":")
            values[key] = int(rest.strip().split()[0])
        total = values.get("MemTotal")
        available = values.get("MemAvailable")
        return (
            int(total / 1024) if total else None,
            int(available / 1024) if available else None,
        )
    except (OSError, ValueError):
        return None, None


def _nvidia_gpus() -> List[GpuInfo]:
    output = _run(
        [
            "nvidia-smi",
            "--query-gpu=index,name,memory.total,memory.free,driver_version",
            "--format=csv,noheader,nounits",
        ]
    )
    if not output:
        return []
    gpus: List[GpuInfo] = []
    for line in output.splitlines():
        parts = [part.strip() for part in line.split(",")]
        if len(parts) < 5:
            continue
        try:
            index = int(parts[0])
            total = int(float(parts[2]))
            free = int(float(parts[3]))
        except ValueError:
            continue
        gpus.append(
            GpuInfo(
                index=index,
                name=parts[1],
                backend="cuda",
                total_vram_mb=total,
                free_vram_mb=free,
                driver=parts[4] or None,
            )
        )
    return gpus


def _apple_gpu() -> List[GpuInfo]:
    if platform.system() != "Darwin" or platform.machine().lower() not in {"arm64", "aarch64"}:
        return []
    total, available = _memory_mb()
    # Unified memory: report shared memory rather than inventing dedicated VRAM.
    return [
        GpuInfo(
            index=0,
            name="Apple Silicon GPU (unified memory)",
            backend="mps",
            total_vram_mb=total,
            free_vram_mb=available,
        )
    ]


def _torch_backend_available(backend: str) -> bool:
    try:
        import torch  # type: ignore
    except Exception:
        return False
    if backend == "cuda":
        return bool(torch.cuda.is_available())
    if backend == "mps":
        return bool(getattr(torch.backends, "mps", None) and torch.backends.mps.is_available())
    return True


def detect_system(data_dir: Path, ffmpeg: Optional[str], ffmpeg_version: Optional[str]) -> SystemInfo:
    system = platform.system()
    gpus = _nvidia_gpus() + _apple_gpu()
    total_ram, available_ram = _memory_mb()
    backends = ["cpu"]
    if any(gpu.backend == "cuda" for gpu in gpus):
        backends.append("cuda")
    if any(gpu.backend == "mps" for gpu in gpus):
        backends.append("mps")

    if "cuda" in backends:
        recommended = "cuda"
    elif "mps" in backends:
        recommended = "mps"
    else:
        recommended = "cpu"

    warnings: List[str] = []
    if total_ram and total_ram < 8192:
        warnings.append("Less than 8 GB of system RAM detected; neural models may fail to load.")
    if not gpus:
        warnings.append("No supported discrete GPU detected. CPU inference may be very slow.")
    if any(gpu.backend == "cuda" and (gpu.total_vram_mb or 0) <= 8192 for gpu in gpus):
        warnings.append(
            "A GPU with 8 GB or less VRAM was detected. Large models may require lower-memory modes."
        )
    if not ffmpeg:
        warnings.append(
            "FFmpeg was not found. MP3, OGG, Opus, AAC, and M4A export will be unavailable until it is installed."
        )
    if sys.version_info < (3, 10):
        warnings.append(
            "Python 3.9 is supported but some optional AI model packages may require Python 3.10 or newer."
        )
    if not _torch_backend_available("cpu"):
        warnings.append(
            "PyTorch is not installed. The built-in Sketch engine works without it; neural models require it."
        )

    free_gb: Optional[float] = None
    try:
        free_gb = round(shutil.disk_usage(str(data_dir)).free / (1024**3), 1)
    except OSError:
        pass

    return SystemInfo(
        app_version="0.1.0",
        platform=system,
        platform_release=platform.release(),
        architecture=platform.machine(),
        cpu_model=_cpu_model(),
        cpu_count=max(1, int(os.cpu_count() or 1)),
        ram_total_mb=total_ram,
        ram_available_mb=available_ram,
        gpus=gpus,
        available_backends=backends,
        recommended_backend=recommended,
        data_dir=str(data_dir),
        ffmpeg_available=bool(ffmpeg),
        ffmpeg_version=ffmpeg_version,
        ffprobe_available=bool(ffmpeg and shutil.which("ffprobe")),
        python_version=platform.python_version(),
        storage_free_gb=free_gb,
        warnings=warnings,
    )


def select_device(preference: str) -> str:
    """Resolve a configured acceleration preference to a usable backend."""
    if preference == "cpu":
        return "cpu"
    if preference == "cuda":
        return "cuda" if _torch_backend_available("cuda") else "cpu"
    if preference == "mps":
        return "mps" if _torch_backend_available("mps") else "cpu"
    if _torch_backend_available("cuda"):
        return "cuda"
    if _torch_backend_available("mps"):
        return "mps"
    return "cpu"


def hardware_summary(data_dir: Path) -> Dict[str, Any]:
    info = detect_system(data_dir, shutil.which("ffmpeg"), None)
    return json.loads(info.model_dump_json())
