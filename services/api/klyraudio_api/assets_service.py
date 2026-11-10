"""Asset library and non-destructive editing services."""

from __future__ import annotations

import hashlib
import shutil
import uuid
from pathlib import Path
from typing import Dict, List, Optional

import numpy as np

from .audio import dsp, io
from .config import Paths, ServiceContext, sanitize_filename
from .errors import NotFound, ValidationFailed
from .repositories import AssetRepository, now_iso
from .schemas import AssetInfo, AssetUpdate, AudioOperationRequest, JoinRequest
from .security import ensure_allowed_existing, resolve_managed

OPERATION_LABELS = {
    "trim": "Trimmed",
    "silence": "Silence applied",
    "fade_in": "Fade in applied",
    "fade_out": "Fade out applied",
    "gain": "Gain applied",
    "normalize": "Normalized",
    "reverse": "Reversed",
    "loop": "Loop crossfade applied",
    "split": "Split",
    "duplicate": "Duplicate",
}


def _checksum(path: Path) -> Optional[str]:
    digest = hashlib.sha256()
    try:
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
    except OSError:
        return None
    return digest.hexdigest()


class AssetService:
    def __init__(self, context: ServiceContext, repository: AssetRepository) -> None:
        self.context = context
        self.paths = context.paths
        self.repository = repository

    def info(self, asset: Dict[str, object]) -> AssetInfo:
        return AssetInfo(
            id=str(asset["id"]),
            name=str(asset["name"]),
            origin=asset["origin"],  # type: ignore[arg-type]
            media_type=asset["media_type"],  # type: ignore[arg-type]
            duration=float(asset["duration"]),
            sample_rate=int(asset["sample_rate"]),
            channels=int(asset["channels"]),
            format=str(asset["format"]),
            size_bytes=int(asset["size_bytes"]),
            created_at=str(asset["created_at"]),
            updated_at=str(asset["updated_at"]),
            source_job_id=asset.get("source_job_id"),  # type: ignore[arg-type]
            parent_asset_id=asset.get("parent_asset_id"),  # type: ignore[arg-type]
            favorite=bool(asset.get("favorite")),
            notes=str(asset.get("notes") or ""),
            tags=list(asset.get("tags") or []),  # type: ignore[arg-type]
            file_url=f"/api/assets/{asset['id']}/audio",
        )

    def get(self, asset_id: str) -> Dict[str, object]:
        asset = self.repository.get(asset_id)
        if not asset:
            raise NotFound("Asset", asset_id)
        return asset

    def file_path(self, asset: Dict[str, object]) -> Path:
        path = resolve_managed(self.paths, str(asset["path"]))
        if not path.is_file():
            raise NotFound("Asset file", str(asset["path"]))
        return path

    def register(
        self,
        path: Path,
        *,
        name: str,
        origin: str,
        media_type: str,
        source_job_id: Optional[str] = None,
        parent_asset_id: Optional[str] = None,
        notes: str = "",
    ) -> Dict[str, object]:
        path = ensure_allowed_existing(self.paths, path)
        metadata = io.probe(path, self.context.ffprobe_path)
        relative = self.paths.relative_to_data(path)
        asset_id = f"as_{uuid.uuid4().hex[:20]}"
        timestamp = now_iso()
        record = {
            "id": asset_id,
            "name": sanitize_filename(name, "Audio")[:200],
            "path": relative,
            "origin": origin,
            "media_type": media_type,
            "duration": round(float(metadata["duration"]), 6),
            "sample_rate": int(metadata["sample_rate"]),
            "channels": int(metadata["channels"]),
            "format": Path(path).suffix.lstrip(".").lower() or "wav",
            "size_bytes": path.stat().st_size,
            "created_at": timestamp,
            "updated_at": timestamp,
            "source_job_id": source_job_id,
            "parent_asset_id": parent_asset_id,
            "favorite": False,
            "notes": notes,
            "checksum": _checksum(path),
        }
        return self.repository.create(record)

    def import_upload(
        self, temp_path: Path, original_name: str, media_type: str = "other"
    ) -> Dict[str, object]:
        target = self.paths.imports / f"{uuid.uuid4().hex[:10]}-{sanitize_filename(original_name)}"
        shutil.move(str(temp_path), target)
        try:
            return self.register(
                target,
                name=Path(original_name).stem,
                origin="imported",
                media_type=media_type,
            )
        except Exception:
            target.unlink(missing_ok=True)
            raise

    def update(self, asset_id: str, update: AssetUpdate) -> AssetInfo:
        self.get(asset_id)
        changes = update.model_dump(exclude_unset=True)
        asset = self.repository.update(asset_id, changes)
        if not asset:
            raise NotFound("Asset", asset_id)
        return self.info(asset)

    def delete(self, asset_id: str, delete_file: bool = True) -> None:
        asset = self.get(asset_id)
        path = resolve_managed(self.paths, str(asset["path"]))
        self.repository.delete(asset_id)
        if delete_file:
            try:
                path.unlink(missing_ok=True)
            except OSError:
                pass

    def _write_edit(self, data: np.ndarray, sample_rate: int) -> Path:
        target = self.paths.media / "edits" / f"{uuid.uuid4().hex}.wav"
        io.write(target, data, sample_rate, subtype="PCM_24")
        return target

    def _base_name(self, asset: Dict[str, object]) -> str:
        return str(asset["name"])[:120]

    def operate(self, asset_id: str, request: AudioOperationRequest) -> tuple[List[AssetInfo], str]:
        asset = self.get(asset_id)
        source = self.file_path(asset)
        audio = io.load(source, ffmpeg=self.context.ffmpeg_path)
        sample_rate = int(asset["sample_rate"])
        duration = float(asset["duration"])
        outputs: List[np.ndarray] = []
        label = OPERATION_LABELS[request.operation]

        if request.operation in {"trim", "split", "silence"}:
            start = float(request.start or 0.0)
            end = float(request.end if request.end is not None else duration)
            if end <= start:
                raise ValidationFailed("The selection end must be after its start.")
            if start >= duration:
                raise ValidationFailed("The selection starts after the end of the audio.")
            end = min(end, duration)
            if request.operation == "trim":
                outputs = [dsp.trim(audio, start, end, sample_rate)]
            elif request.operation == "silence":
                outputs = [dsp.silence(audio, start, end, sample_rate)]
            else:
                # Split into two assets with tiny boundary fades to prevent clicks.
                first = dsp.fade(dsp.trim(audio, 0, start, sample_rate), 0.0, 0.005, sample_rate)
                second = dsp.fade(dsp.trim(audio, start, duration, sample_rate), 0.005, 0.0, sample_rate)
                if first.shape[0] == 0 or second.shape[0] == 0:
                    raise ValidationFailed("The split position must be inside the audio.")
                outputs = [first, second]
        elif request.operation in {"fade_in", "fade_out"}:
            amount = float(request.amount if request.amount is not None else 1.0)
            if amount <= 0 or amount > duration:
                raise ValidationFailed("The fade duration must be greater than zero and within the audio.")
            if request.operation == "fade_in":
                outputs = [dsp.fade(audio, amount, 0.0, sample_rate)]
            else:
                outputs = [dsp.fade(audio, 0.0, amount, sample_rate)]
        elif request.operation == "gain":
            amount = float(request.amount if request.amount is not None else 0.0)
            if not -60.0 <= amount <= 24.0:
                raise ValidationFailed("Gain must be between -60 dB and +24 dB.")
            outputs = [dsp.apply_gain(audio, amount)]
        elif request.operation == "normalize":
            outputs = [dsp.normalize(audio, -1.0)]
        elif request.operation == "reverse":
            outputs = [dsp.reverse(audio)]
        elif request.operation == "loop":
            crossfade = float(request.crossfade if request.crossfade is not None else min(1.0, duration / 4))
            outputs = [dsp.make_loop(audio, crossfade, sample_rate)]
        elif request.operation == "duplicate":
            target = self.paths.media / "edits" / f"{uuid.uuid4().hex}.wav"
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)
            duplicate = self.register(
                target,
                name=f"{self._base_name(asset)} copy",
                origin="edited",
                media_type=str(asset["media_type"]),
                parent_asset_id=asset_id,
            )
            return [self.info(duplicate)], "Duplicated"

        created: List[AssetInfo] = []
        for index, output in enumerate(outputs):
            if output.size == 0:
                raise ValidationFailed("The edit produced empty audio.")
            target = self._write_edit(output, sample_rate)
            suffix = " (A)" if request.operation == "split" and index == 0 else " (B)" if request.operation == "split" else ""
            name = request.name or f"{self._base_name(asset)} — {label}{suffix}"
            record = self.register(
                target,
                name=name,
                origin="edited",
                media_type=str(asset["media_type"]),
                parent_asset_id=asset_id,
            )
            created.append(self.info(record))
        return created, label

    def join(self, request: JoinRequest) -> List[AssetInfo]:
        if not request.asset_ids:
            raise ValidationFailed("Select at least one audio file to join.")
        assets = [self.get(asset_id) for asset_id in request.asset_ids]
        target_rate = max(int(asset["sample_rate"]) for asset in assets)
        parts = [
            io.load(
                self.file_path(asset),
                target_sr=target_rate,
                ffmpeg=self.context.ffmpeg_path,
            )
            for asset in assets
        ]
        combined = dsp.join(parts, request.crossfade, target_rate)
        target = self._write_edit(combined, target_rate)
        name = request.name or f"{assets[0]['name']} + {len(assets) - 1} more"
        record = self.register(
            target,
            name=str(name),
            origin="edited",
            media_type=str(assets[0]["media_type"]),
            parent_asset_id=str(assets[0]["id"]),
        )
        return [self.info(record)]
