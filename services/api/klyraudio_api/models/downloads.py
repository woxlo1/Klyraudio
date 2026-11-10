"""Opt-in model downloads with progress, cancellation, and checksum verification.

Model weights are never bundled with Klyraudio. Downloads use HTTPS only, never
disable TLS verification, and verify SHA-256 checksums published by the model
host (Hugging Face LFS metadata) when available.
"""

from __future__ import annotations

import hashlib
import os
import shutil
import threading
import time
import uuid
from pathlib import Path
from typing import Dict, List, Optional
from urllib.parse import quote

import httpx

from ..config import ConfigStore, Paths, sanitize_filename
from ..errors import ApiError, NotFound, ResourceBusy, ValidationFailed
from ..repositories import DownloadRepository, ModelInstallRepository, now_iso
from ..schemas import DownloadInfo
from .registry import ModelDefinition, get_model

HF_API = "https://huggingface.co/api/models"
HF_RESOLVE = "https://huggingface.co"
SKIP_SUFFIXES = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".md", ".csv", ".gitattributes"}
REQUIRED_FREE_MARGIN = 512 * 1024 * 1024


def _token() -> Optional[str]:
    return os.environ.get("HF_TOKEN") or os.environ.get("HUGGING_FACE_HUB_TOKEN")


def _size_label(value: Optional[int]) -> str:
    if value is None:
        return "unknown size"
    if value >= 1024**3:
        return f"{value / 1024**3:.1f} GB"
    return f"{value / 1024**2:.0f} MB"


class DownloadManager:
    def __init__(
        self,
        paths: Paths,
        config: ConfigStore,
        downloads: DownloadRepository,
        installs: ModelInstallRepository,
    ) -> None:
        self.paths = paths
        self.config = config
        self.downloads = downloads
        self.installs = installs
        self._threads: Dict[str, threading.Thread] = {}
        self._cancels: Dict[str, threading.Event] = {}
        self._lock = threading.RLock()

    def _active(self) -> Optional[Dict[str, object]]:
        for item in self.downloads.list(limit=20):
            if item["status"] in {"queued", "running"}:
                return item
        return None

    def start(
        self, model_id: str, accept_license: bool, version: Optional[str] = None
    ) -> DownloadInfo:
        definition = get_model(model_id)
        if not definition:
            raise NotFound("Model", model_id)
        if definition.builtin:
            raise ValidationFailed("This model is built in and does not need a download.")
        if not accept_license:
            raise ValidationFailed(
                "You must review and accept the model license before downloading.",
                {"license_name": definition.license_name, "license_url": definition.license_url},
            )
        with self._lock:
            active = self._active()
            if active:
                raise ResourceBusy(
                    "Another model download is already running. Wait for it to finish or cancel it."
                )

        files = self._list_files(definition)
        if not files:
            raise ApiError(
                "download_unavailable",
                "No downloadable files were returned by the model host.",
                status_code=502,
            )
        total = sum(int(item.get("size") or 0) for item in files) or None
        self._check_disk(total)

        acknowledgements = dict(self.config.settings.model_license_acknowledgements)
        acknowledgements[model_id] = now_iso()
        self.config.update(model_license_acknowledgements=acknowledgements)

        download_id = f"dl_{uuid.uuid4().hex[:16]}"
        record = self.downloads.create(
            {
                "id": download_id,
                "model_id": model_id,
                "status": "queued",
                "progress": 0,
                "total_bytes": total,
                "downloaded_bytes": 0,
                "current_file": None,
                "created_at": now_iso(),
                "files": files,
            }
        )
        cancel = threading.Event()
        thread = threading.Thread(
            target=self._run,
            args=(download_id, definition, files, cancel),
            name=f"download-{model_id}",
            daemon=True,
        )
        with self._lock:
            self._cancels[download_id] = cancel
            self._threads[download_id] = thread
        thread.start()
        return self._to_info(record)

    def cancel(self, download_id: str) -> DownloadInfo:
        item = self.downloads.get(download_id)
        if not item:
            raise NotFound("Download", download_id)
        if item["status"] not in {"queued", "running"}:
            return self._to_info(item)
        with self._lock:
            event = self._cancels.get(download_id)
            if event:
                event.set()
        self.downloads.update(download_id, {"cancel_requested": True})
        return self._to_info(self.downloads.get(download_id) or item)

    def list(self) -> List[DownloadInfo]:
        return [self._to_info(item) for item in self.downloads.list()]

    def remove(self, model_id: str) -> None:
        definition = get_model(model_id)
        if not definition:
            raise NotFound("Model", model_id)
        if definition.builtin:
            raise ValidationFailed("The built-in Sketch engine cannot be removed.")
        with self._lock:
            active = self.downloads.active_for_model(model_id)
            if active:
                raise ResourceBusy("Cancel the active download before removing this model.")
        model_dir = self._model_dir(model_id)
        if model_dir.exists():
            shutil.rmtree(model_dir, ignore_errors=False)
        self.installs.delete(model_id)

    def _model_dir(self, model_id: str) -> Path:
        target = (self.paths.models / model_id).resolve()
        try:
            target.relative_to(self.paths.models.resolve())
        except ValueError as exc:
            raise ApiError("invalid_model_path", "Invalid model path.", status_code=400) from exc
        return target

    def _to_info(self, item: Dict[str, object]) -> DownloadInfo:
        return DownloadInfo(
            id=str(item["id"]),
            model_id=str(item["model_id"]),
            status=item["status"],  # type: ignore[arg-type]
            progress=float(item["progress"] or 0),
            total_bytes=item.get("total_bytes"),  # type: ignore[arg-type]
            downloaded_bytes=int(item.get("downloaded_bytes") or 0),
            current_file=item.get("current_file"),  # type: ignore[arg-type]
            error=item.get("error"),  # type: ignore[arg-type]
            created_at=str(item["created_at"]),
            finished_at=item.get("finished_at"),  # type: ignore[arg-type]
        )

    def _check_disk(self, total: Optional[int]) -> None:
        if not total:
            return
        try:
            free = shutil.disk_usage(str(self.paths.data_dir)).free
        except OSError:
            return
        if free < total + REQUIRED_FREE_MARGIN:
            raise ApiError(
                "insufficient_disk_space",
                "There is not enough free disk space for this model.",
                status_code=507,
                details={
                    "required": total,
                    "free": free,
                    "required_label": _size_label(total),
                    "free_label": _size_label(free),
                },
                remediation="Free disk space or choose a smaller model.",
            )

    def _list_files(self, definition: ModelDefinition) -> List[Dict[str, object]]:
        if not definition.repo_id:
            raise ApiError("download_unavailable", "The model has no download source.", status_code=502)
        headers = {"User-Agent": "Klyraudio/0.1 (+local model manager)"}
        token = _token()
        if token:
            headers["Authorization"] = f"Bearer {token}"
        url = f"{HF_API}/{definition.repo_id}/tree/main?recursive=true"
        try:
            response = httpx.get(url, headers=headers, timeout=30.0, follow_redirects=True)
        except httpx.HTTPError as exc:
            raise ApiError(
                "download_metadata_failed",
                "Could not reach the model host to list files.",
                status_code=502,
                remediation="Check your internet connection and try again.",
            ) from exc
        if response.status_code in {401, 403}:
            raise ApiError(
                "model_gated",
                "This model requires a Hugging Face account and license acceptance.",
                status_code=403,
                details={"model_url": definition.source_url},
                remediation=(
                    "Accept the model license on its Hugging Face page, then sign in with "
                    "`huggingface-cli login` or set the HF_TOKEN environment variable before "
                    "restarting Klyraudio."
                ),
            )
        if response.status_code != 200:
            raise ApiError(
                "download_metadata_failed",
                f"The model host returned HTTP {response.status_code} while listing files.",
                status_code=502,
            )
        try:
            entries = response.json()
        except ValueError as exc:
            raise ApiError("download_metadata_failed", "The model host returned invalid metadata.", status_code=502) from exc
        files: List[Dict[str, object]] = []
        for entry in entries if isinstance(entries, list) else []:
            if entry.get("type") != "file":
                continue
            path = str(entry.get("path") or "")
            if not path or path in definition.exclude_files:
                continue
            suffix = Path(path).suffix.lower()
            if suffix in SKIP_SUFFIXES or path.endswith(".gitattributes"):
                continue
            if Path(path).name.lower().startswith("readme"):
                continue
            lfs = entry.get("lfs") or {}
            files.append(
                {
                    "path": path,
                    "size": int(entry.get("size") or lfs.get("size") or 0),
                    "sha256": lfs.get("oid"),
                }
            )
        return files

    def _run(
        self,
        download_id: str,
        definition: ModelDefinition,
        files: List[Dict[str, object]],
        cancel: threading.Event,
    ) -> None:
        model_dir = self._model_dir(definition.id)
        downloaded = 0
        total = sum(int(item.get("size") or 0) for item in files) or None
        started = time.monotonic()
        try:
            model_dir.mkdir(parents=True, exist_ok=True)
            self.downloads.update(
                download_id,
                {"status": "running", "current_file": None, "progress": 0.0},
            )
            headers = {"User-Agent": "Klyraudio/0.1 (+local model manager)"}
            token = _token()
            if token:
                headers["Authorization"] = f"Bearer {token}"
            with httpx.Client(headers=headers, timeout=60.0, follow_redirects=True) as client:
                for item in files:
                    if cancel.is_set():
                        raise _Cancelled()
                    relative = str(item["path"])
                    destination = (model_dir / relative).resolve()
                    try:
                        destination.relative_to(model_dir.resolve())
                    except ValueError as exc:
                        raise ApiError(
                            "invalid_model_file",
                            "The model host returned an unsafe file path.",
                            status_code=502,
                        ) from exc
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    expected_size = int(item.get("size") or 0)
                    partial = destination.with_suffix(destination.suffix + ".part")
                    self.downloads.update(
                        download_id,
                        {
                            "current_file": relative,
                            "downloaded_bytes": downloaded,
                            "progress": (downloaded / total) if total else 0.0,
                        },
                    )
                    url = (
                        f"{HF_RESOLVE}/{definition.repo_id}/resolve/main/{quote(relative)}"
                    )
                    digest = hashlib.sha256()
                    written = 0
                    with client.stream("GET", url) as response:
                        if response.status_code in {401, 403}:
                            raise ApiError(
                                "model_gated",
                                "The model host denied access. Accept the license and authenticate again.",
                                status_code=403,
                                remediation="Set HF_TOKEN or run `huggingface-cli login`.",
                            )
                        if response.status_code != 200:
                            raise ApiError(
                                "download_failed",
                                f"The model host returned HTTP {response.status_code} for {relative}.",
                                status_code=502,
                            )
                        with partial.open("wb") as handle:
                            for chunk in response.iter_bytes(1024 * 1024):
                                if cancel.is_set():
                                    raise _Cancelled()
                                if not chunk:
                                    continue
                                handle.write(chunk)
                                digest.update(chunk)
                                written += len(chunk)
                                downloaded += len(chunk)
                                now = time.monotonic()
                                if now - started > 0.15:
                                    started = now
                                    self.downloads.update(
                                        download_id,
                                        {
                                            "downloaded_bytes": downloaded,
                                            "progress": min(0.99, downloaded / total)
                                            if total
                                            else 0.0,
                                            "current_file": relative,
                                        },
                                    )
                    if expected_size and written != expected_size:
                        raise ApiError(
                            "download_size_mismatch",
                            f"The downloaded size for {relative} did not match the expected size.",
                            status_code=502,
                            details={"expected": expected_size, "received": written},
                        )
                    expected_hash = item.get("sha256")
                    if expected_hash and digest.hexdigest() != expected_hash:
                        raise ApiError(
                            "checksum_mismatch",
                            f"The SHA-256 checksum for {relative} did not match.",
                            status_code=502,
                            remediation="The download may be corrupted. Remove the model and try again.",
                        )
                    partial.replace(destination)
            if cancel.is_set():
                raise _Cancelled()
            size = sum(path.stat().st_size for path in model_dir.rglob("*") if path.is_file())
            self.installs.upsert(
                definition.id,
                version="main",
                path=str(model_dir),
                size_bytes=size,
            )
            self.downloads.update(
                download_id,
                {
                    "status": "completed",
                    "progress": 1.0,
                    "downloaded_bytes": downloaded,
                    "total_bytes": total or downloaded,
                    "current_file": None,
                    "finished_at": now_iso(),
                },
            )
        except _Cancelled:
            shutil.rmtree(model_dir, ignore_errors=True)
            self.downloads.update(
                download_id,
                {
                    "status": "cancelled",
                    "current_file": None,
                    "finished_at": now_iso(),
                },
            )
        except ApiError as exc:
            shutil.rmtree(model_dir, ignore_errors=True)
            self.downloads.update(
                download_id,
                {
                    "status": "failed",
                    "error": exc.message,
                    "current_file": None,
                    "finished_at": now_iso(),
                },
            )
        except Exception as exc:  # last-resort boundary for a background thread
            shutil.rmtree(model_dir, ignore_errors=True)
            self.downloads.update(
                download_id,
                {
                    "status": "failed",
                    "error": f"Download failed: {exc.__class__.__name__}",
                    "current_file": None,
                    "finished_at": now_iso(),
                },
            )
        finally:
            with self._lock:
                self._cancels.pop(download_id, None)
                self._threads.pop(download_id, None)


class _Cancelled(Exception):
    pass
