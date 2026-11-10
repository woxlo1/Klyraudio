"""Local API routers."""

from __future__ import annotations

import io as stdlib_io
import shutil
import uuid
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, File, Form, Query, Request, UploadFile
from fastapi.responses import JSONResponse, Response, StreamingResponse
from starlette.background import BackgroundTask

from .audio import io, waveform
from .config import SUPPORTED_IMPORT_EXTENSIONS, allow_lan
from .errors import ApiError, NotFound, ValidationFailed
from .hardware import detect_system
from .models.catalog import list_models, model_info
from .repositories import now_iso
from .schemas import (
    AssetInfo,
    AssetListResponse,
    AssetUpdate,
    AudioOperationRequest,
    AudioOperationResponse,
    DownloadInfo,
    ExportCapabilities,
    ExportRequest,
    ExportResult,
    GenerationRequest,
    HealthResponse,
    JoinRequest,
    JobCreateResponse,
    JobInfo,
    ModelInfo,
    ModelInstallRequest,
    ProjectCreate,
    ProjectInfo,
    ProjectSummary,
    ProjectUpdate,
    RenderRequest,
    RuntimeSettingsResponse,
    RuntimeSettingsUpdate,
    SystemInfo,
    WaveformResponse,
)
from .security import check_upload_name
from .services import Services

MAX_IMPORT_BYTES = 1024 * 1024 * 1024
CONTENT_TYPES = {
    ".wav": "audio/wav",
    ".wave": "audio/wav",
    ".mp3": "audio/mpeg",
    ".flac": "audio/flac",
    ".ogg": "audio/ogg",
    ".oga": "audio/ogg",
    ".opus": "audio/opus",
    ".m4a": "audio/mp4",
    ".aac": "audio/aac",
    ".aiff": "audio/aiff",
    ".aif": "audio/aiff",
    ".webm": "audio/webm",
}


def build_router(services: Services) -> APIRouter:
    router = APIRouter(prefix="/api")
    context = services.context

    # ------------------------------------------------------------------ health/system
    @router.get("/health", response_model=HealthResponse)
    def health() -> HealthResponse:
        import time

        return HealthResponse(
            status="ok",
            version=context.describe()["version"],
            database_version=services.database.schema_version(),
            uptime_seconds=max(0.0, time.time() - (context.started_at or time.time())),
            local_only=not allow_lan(),
        )

    @router.get("/system/info", response_model=SystemInfo)
    def system_info() -> SystemInfo:
        info = detect_system(
            context.paths.data_dir,
            context.ffmpeg_path,
            io.ffmpeg_version(context.ffmpeg_path),
        )
        info.ffprobe_available = bool(context.ffprobe_path)
        info.ffmpeg_available = bool(context.ffmpeg_path)
        info.ffmpeg_version = io.ffmpeg_version(context.ffmpeg_path)
        return info

    # ------------------------------------------------------------------ settings
    @router.get("/settings", response_model=RuntimeSettingsResponse)
    def get_settings() -> RuntimeSettingsResponse:
        return RuntimeSettingsResponse(**services.config.settings.model_dump())

    @router.patch("/settings", response_model=RuntimeSettingsResponse)
    def update_settings(update: RuntimeSettingsUpdate) -> RuntimeSettingsResponse:
        changes = update.model_dump(exclude_unset=True, exclude_none=True)
        if not changes:
            return RuntimeSettingsResponse(**services.config.settings.model_dump())
        settings = services.config.update(**changes)
        return RuntimeSettingsResponse(**settings.model_dump())

    @router.get("/storage")
    def storage_info() -> dict:
        data_dir = context.paths.data_dir
        total = 0
        for root in context.paths.allowed_roots():
            for path in root.rglob("*"):
                if path.is_file():
                    try:
                        total += path.stat().st_size
                    except OSError:
                        pass
        return {"data_dir": str(data_dir), "managed_bytes": total}

    # ------------------------------------------------------------------ models
    @router.get("/models", response_model=list[ModelInfo])
    def models() -> list[ModelInfo]:
        return list_models(services.config.settings, services.installs_repo)

    @router.get("/models/downloads", response_model=list[DownloadInfo])
    def downloads() -> list[DownloadInfo]:
        return services.downloads.list()

    @router.get("/models/{model_id}", response_model=ModelInfo)
    def model(model_id: str) -> ModelInfo:
        info = model_info(model_id, services.config.settings, services.installs_repo)
        if not info:
            raise NotFound("Model", model_id)
        return info

    @router.post("/models/{model_id}/install", response_model=DownloadInfo)
    def install_model(model_id: str, request: ModelInstallRequest) -> DownloadInfo:
        return services.downloads.start(model_id, request.accept_license, request.version)

    @router.post("/models/{model_id}/acknowledge-license", response_model=ModelInfo)
    def acknowledge_license(model_id: str) -> ModelInfo:
        info = model_info(model_id, services.config.settings, services.installs_repo)
        if not info:
            raise NotFound("Model", model_id)
        acknowledgements = dict(services.config.settings.model_license_acknowledgements)
        acknowledgements[model_id] = now_iso()
        services.config.update(model_license_acknowledgements=acknowledgements)
        info = model_info(model_id, services.config.settings, services.installs_repo)
        if not info:
            raise NotFound("Model", model_id)
        return info

    @router.post("/models/downloads/{download_id}/cancel", response_model=DownloadInfo)
    def cancel_download(download_id: str) -> DownloadInfo:
        return services.downloads.cancel(download_id)

    @router.delete("/models/{model_id}")
    def remove_model(model_id: str) -> dict:
        services.downloads.remove(model_id)
        return {"removed": True}

    # ------------------------------------------------------------------ generation / jobs
    @router.post("/generations", response_model=JobCreateResponse)
    def generate(request: GenerationRequest) -> JobCreateResponse:
        jobs, warnings = services.jobs.submit(request)
        return JobCreateResponse(jobs=jobs, warnings=warnings)

    @router.get("/jobs", response_model=list[JobInfo])
    def jobs(status: Optional[str] = None) -> list[JobInfo]:
        return services.jobs.list(status=status)

    @router.get("/jobs/{job_id}", response_model=JobInfo)
    def job(job_id: str) -> JobInfo:
        return services.jobs.get(job_id)

    @router.post("/jobs/{job_id}/cancel", response_model=JobInfo)
    def cancel_job(job_id: str) -> JobInfo:
        return services.jobs.cancel(job_id)

    @router.post("/jobs/{job_id}/retry", response_model=JobInfo)
    def retry_job(job_id: str) -> JobInfo:
        return services.jobs.retry(job_id)

    @router.delete("/jobs/{job_id}")
    def delete_job(job_id: str) -> dict:
        services.jobs.delete(job_id)
        return {"deleted": True}

    # ------------------------------------------------------------------ assets / library
    @router.get("/assets", response_model=AssetListResponse)
    def assets(
        query: str = "",
        media_type: Optional[str] = None,
        origin: Optional[str] = None,
        favorite: Optional[bool] = None,
        tag: Optional[str] = None,
        sort: str = "newest",
        limit: int = Query(default=100, ge=1, le=500),
        offset: int = Query(default=0, ge=0),
    ) -> AssetListResponse:
        records, total = services.assets_repo.list(
            query=query,
            media_type=media_type,
            origin=origin,
            favorite=favorite,
            tag=tag,
            sort=sort,
            limit=limit,
            offset=offset,
        )
        return AssetListResponse(
            items=[services.assets.info(record) for record in records], total=total
        )

    @router.get("/assets/tags")
    def tags() -> list[dict]:
        return services.assets_repo.all_tags()

    @router.post("/assets/import", response_model=AssetInfo)
    async def import_asset(
        file: UploadFile = File(...),
        media_type: str = Form(default="other"),
    ) -> AssetInfo:
        filename = file.filename or "import.wav"
        try:
            safe_name = check_upload_name(filename, SUPPORTED_IMPORT_EXTENSIONS)
        except ValueError as exc:
            raise ValidationFailed(str(exc)) from exc
        if media_type not in {"music", "sfx", "ambient", "voice", "other"}:
            raise ValidationFailed("Invalid media type.")
        temp = context.paths.tmp / f"{uuid.uuid4().hex}-{safe_name}"
        size = 0
        try:
            with temp.open("wb") as handle:
                while True:
                    chunk = await file.read(1024 * 1024)
                    if not chunk:
                        break
                    size += len(chunk)
                    if size > MAX_IMPORT_BYTES:
                        raise ValidationFailed("The imported file exceeds the 1 GB limit.")
                    handle.write(chunk)
            if size == 0:
                raise ValidationFailed("The uploaded file is empty.")
            asset = services.assets.import_upload(temp, safe_name, media_type)
            return services.assets.info(asset)
        finally:
            temp.unlink(missing_ok=True)

    @router.get("/assets/{asset_id}", response_model=AssetInfo)
    def asset(asset_id: str) -> AssetInfo:
        return services.assets.info(services.assets.get(asset_id))

    @router.patch("/assets/{asset_id}", response_model=AssetInfo)
    def update_asset(asset_id: str, update: AssetUpdate) -> AssetInfo:
        return services.assets.update(asset_id, update)

    @router.delete("/assets/{asset_id}")
    def delete_asset(asset_id: str, delete_file: bool = True) -> dict:
        services.assets.delete(asset_id, delete_file=delete_file)
        return {"deleted": True}

    @router.post("/assets/join", response_model=AudioOperationResponse)
    def join_assets(request: JoinRequest) -> AudioOperationResponse:
        items = services.assets.join(request)
        return AudioOperationResponse(assets=items, description="Joined audio")

    @router.post("/assets/{asset_id}/operations", response_model=AudioOperationResponse)
    def operate(asset_id: str, request: AudioOperationRequest) -> AudioOperationResponse:
        items, description = services.assets.operate(asset_id, request)
        return AudioOperationResponse(assets=items, description=description)

    @router.get("/assets/{asset_id}/audio")
    def asset_audio(asset_id: str, request: Request):
        asset = services.assets.get(asset_id)
        path = services.assets.file_path(asset)
        return _range_response(request, path)

    @router.get("/assets/{asset_id}/waveform", response_model=WaveformResponse)
    def asset_waveform(
        asset_id: str, points: int = Query(default=900, ge=64, le=4000)
    ) -> WaveformResponse:
        asset = services.assets.get(asset_id)
        path = services.assets.file_path(asset)
        peaks = waveform.compute_peaks(
            path,
            points,
            context.paths.waveforms,
            context.ffmpeg_path,
        )
        return WaveformResponse(
            asset_id=asset_id,
            duration=float(asset["duration"]),
            channels=int(asset["channels"]),
            peaks=peaks,
            sample_rate=int(asset["sample_rate"]),
        )

    # ------------------------------------------------------------------ projects
    @router.get("/projects", response_model=list[ProjectSummary])
    def projects() -> list[ProjectSummary]:
        return services.projects.list()

    @router.post("/projects", response_model=ProjectInfo)
    def create_project(request: ProjectCreate) -> ProjectInfo:
        return services.projects.create(request.name, request.sample_rate)

    @router.get("/projects/{project_id}", response_model=ProjectInfo)
    def project(project_id: str) -> ProjectInfo:
        return services.projects.get(project_id)

    @router.put("/projects/{project_id}", response_model=ProjectInfo)
    def update_project(project_id: str, request: ProjectUpdate) -> ProjectInfo:
        return services.projects.update(project_id, request.document, request.autosave)

    @router.delete("/projects/{project_id}")
    def delete_project(project_id: str) -> dict:
        services.projects.delete(project_id)
        return {"deleted": True}

    @router.post("/projects/{project_id}/render", response_model=AssetInfo)
    def render_project(project_id: str, request: RenderRequest) -> AssetInfo:
        return services.projects.render(project_id, request)

    # ------------------------------------------------------------------ export
    @router.get("/export/capabilities", response_model=ExportCapabilities)
    def export_capabilities() -> ExportCapabilities:
        return services.exports.capabilities()

    @router.post("/export", response_model=ExportResult)
    def export_audio(request: ExportRequest) -> ExportResult:
        return services.exports.export(request)

    @router.get("/export/history")
    def export_history(limit: int = Query(default=50, ge=1, le=200)) -> list[dict]:
        return services.exports.history(limit)

    @router.get("/export/folder")
    def export_folder() -> dict:
        return {"path": services.exports.exports_dir()}

    return router


def _range_response(request: Request, path: Path):
    file_size = path.stat().st_size
    media_type = CONTENT_TYPES.get(path.suffix.lower(), "application/octet-stream")
    range_header = request.headers.get("range")
    if not range_header:
        def iterate():
            with path.open("rb") as handle:
                while True:
                    chunk = handle.read(1024 * 256)
                    if not chunk:
                        break
                    yield chunk

        return StreamingResponse(
            iterate(),
            media_type=media_type,
            headers={
                "Accept-Ranges": "bytes",
                "Content-Length": str(file_size),
                "Cache-Control": "private, max-age=3600",
            },
        )
    try:
        units, _, spec = range_header.partition("=")
        if units != "bytes":
            raise ValueError
        start_text, _, end_text = spec.partition("-")
        start = int(start_text) if start_text else 0
        end = int(end_text) if end_text else file_size - 1
        if start < 0 or end < start or start >= file_size:
            raise ValueError
        end = min(end, file_size - 1)
    except ValueError:
        return Response(
            status_code=416,
            headers={"Content-Range": f"bytes */{file_size}"},
        )
    length = end - start + 1

    def iterate_range():
        remaining = length
        with path.open("rb") as handle:
            handle.seek(start)
            while remaining > 0:
                chunk = handle.read(min(1024 * 256, remaining))
                if not chunk:
                    break
                remaining -= len(chunk)
                yield chunk

    return StreamingResponse(
        iterate_range(),
        status_code=206,
        media_type=media_type,
        headers={
            "Content-Range": f"bytes {start}-{end}/{file_size}",
            "Accept-Ranges": "bytes",
            "Content-Length": str(length),
            "Cache-Control": "private, max-age=3600",
        },
    )
