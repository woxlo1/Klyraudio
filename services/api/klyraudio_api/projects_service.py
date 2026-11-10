"""Project persistence and multitrack rendering."""

from __future__ import annotations

import uuid
from typing import Dict, List

import numpy as np

from .assets_service import AssetService
from .audio import dsp, effects, io
from .config import PROJECT_FORMAT_VERSION, ServiceContext
from .errors import NotFound, ValidationFailed
from .repositories import AssetRepository, ProjectRepository, now_iso
from .schemas import (
    EffectSpec,
    ProjectDocument,
    ProjectInfo,
    ProjectSummary,
    RenderRequest,
)


class ProjectService:
    def __init__(
        self, context: ServiceContext, projects: ProjectRepository, assets: AssetRepository
    ) -> None:
        self.context = context
        self.projects = projects
        self.assets = AssetService(context, assets)

    def create(self, name: str, sample_rate: int = 44100) -> ProjectInfo:
        if sample_rate not in {22050, 32000, 44100, 48000, 96000}:
            raise ValidationFailed("Unsupported project sample rate.")
        project_id = f"prj_{uuid.uuid4().hex[:16]}"
        timestamp = now_iso()
        document = ProjectDocument(
            version=PROJECT_FORMAT_VERSION,
            id=project_id,
            name=name.strip(),
            sample_rate=sample_rate,
            tracks=[],
            master=_default_master(),
            created_at=timestamp,
            updated_at=timestamp,
        )
        record = self.projects.create(
            project_id,
            name.strip(),
            document.model_dump(mode="json"),
            PROJECT_FORMAT_VERSION,
        )
        return self.info(record)

    def get(self, project_id: str) -> ProjectInfo:
        record = self.projects.get(project_id)
        if not record:
            raise NotFound("Project", project_id)
        return self.info(record)

    def update(
        self, project_id: str, document: ProjectDocument, autosave: bool = False
    ) -> ProjectInfo:
        existing = self.projects.get(project_id)
        if not existing:
            raise NotFound("Project", project_id)
        if document.id != project_id:
            raise ValidationFailed("The project document id does not match the requested project.")
        if document.version != PROJECT_FORMAT_VERSION:
            raise ValidationFailed(
                "Unsupported project format version.",
                {"supported": PROJECT_FORMAT_VERSION, "received": document.version},
            )
        self._validate_references(document)
        document.updated_at = now_iso()
        self.projects.update(
            project_id,
            document=document.model_dump(mode="json"),
            version=document.version,
            autosave=autosave,
            name=document.name,
        )
        return self.get(project_id)

    def list(self) -> List[ProjectSummary]:
        return [self.summary(record) for record in self.projects.list()]

    def delete(self, project_id: str) -> None:
        if not self.projects.get(project_id):
            raise NotFound("Project", project_id)
        self.projects.delete(project_id)

    def info(self, record: Dict[str, object]) -> ProjectInfo:
        summary = self.summary(record)
        document = ProjectDocument(**record["document"])  # type: ignore[arg-type]
        return ProjectInfo(**summary.model_dump(), document=document)

    def summary(self, record: Dict[str, object]) -> ProjectSummary:
        document = record["document"]
        tracks = document.get("tracks", []) if isinstance(document, dict) else []
        duration = 0.0
        for track in tracks:
            for clip in track.get("clips", []):
                duration = max(duration, float(clip.get("start", 0)) + float(clip.get("duration", 0)))
        return ProjectSummary(
            id=str(record["id"]),
            name=str(record["name"]),
            track_count=len(tracks),
            duration=round(duration, 3),
            created_at=str(record["created_at"]),
            updated_at=str(record["updated_at"]),
            has_autosave=bool(record.get("autosave")),
        )

    def _validate_references(self, document: ProjectDocument) -> None:
        for track in document.tracks:
            for clip in track.clips:
                if not self.assets.repository.get(clip.asset_id):
                    raise ValidationFailed(
                        "A clip references an audio asset that no longer exists.",
                        {"asset_id": clip.asset_id, "track": track.name},
                    )
                if clip.start < 0 or clip.duration <= 0:
                    raise ValidationFailed("Clip timing must be positive.")
                if clip.fade_in + clip.fade_out > clip.duration:
                    raise ValidationFailed("Clip fades cannot be longer than the clip.")

    def render(self, project_id: str, request: RenderRequest):
        project = self.get(project_id)
        document = project.document
        sample_rate = int(request.sample_rate or document.sample_rate)
        if sample_rate not in {22050, 32000, 44100, 48000, 96000}:
            raise ValidationFailed("Unsupported render sample rate.")

        any_solo = any(track.solo for track in document.tracks)
        placeholders: List[tuple[int, np.ndarray, float, float]] = []
        total_frames = 0
        for track in document.tracks:
            if track.mute or (any_solo and not track.solo):
                continue
            for clip in track.clips:
                asset = self.assets.get(clip.asset_id)
                source = self.assets.file_path(asset)
                try:
                    audio = io.load(
                        source,
                        target_sr=sample_rate,
                        ffmpeg=self.context.ffmpeg_path,
                    )
                except Exception as exc:
                    raise ValidationFailed(
                        f"Could not decode a clip's source audio: {asset['name']}",
                        {"asset_id": clip.asset_id},
                    ) from exc
                start_frame = int(round(clip.start * sample_rate))
                offset = max(0, int(round(clip.offset * sample_rate)))
                frames = max(1, int(round(clip.duration * sample_rate)))
                segment = audio[offset : offset + frames]
                if segment.shape[0] == 0:
                    continue
                segment = dsp.fade(
                    segment,
                    clip.fade_in,
                    clip.fade_out,
                    sample_rate,
                )
                gain = clip.gain * track.volume
                pan = float(np.clip(track.pan + (clip.gain * 0.0), -1.0, 1.0))
                placeholders.append((start_frame, segment, gain, pan))
                total_frames = max(total_frames, start_frame + segment.shape[0])

        if total_frames == 0:
            raise ValidationFailed("This project has no audible clips to render.")
        master_chain: List[EffectSpec] = []
        if request.master_effects:
            master_chain = [effect for effect in document.master.effects if effect.enabled]
        # Only time-based master effects need room for their tails. Rendering a dry
        # mix must end exactly with the last clip instead of adding silent padding.
        needs_tail = any(effect.type in {"reverb", "delay"} for effect in master_chain)
        if needs_tail:
            tail = int(8.0 * sample_rate)
            total_frames = min(total_frames + tail, int(3600 * sample_rate))
        mix = np.zeros((total_frames, 2), dtype=np.float32)
        for start_frame, segment, gain, pan in placeholders:
            dsp.mix_at(mix, segment, start_frame, gain, pan)

        if master_chain:
            mix = effects.apply_chain(mix, sample_rate, master_chain)
        mix = mix * float(document.master.volume)
        if request.normalize or document.master.normalize:
            mix = dsp.normalize(mix, -1.0)
        else:
            mix = effects.apply_limiter(mix, sample_rate, {"ceiling_db": -0.3})

        target = (
            self.context.paths.media
            / "renders"
            / f"{project_id}-{uuid.uuid4().hex[:8]}.wav"
        )
        io.write(target, mix, sample_rate, subtype="PCM_24")
        asset = self.assets.register(
            target,
            name=f"{document.name} — Mix",
            origin="rendered",
            media_type="other",
            notes=f"Rendered from project {project_id}",
        )
        return self.assets.info(asset)


def _default_master():
    from .schemas import MasterSpec

    return MasterSpec(volume=1.0, effects=[], normalize=True)
