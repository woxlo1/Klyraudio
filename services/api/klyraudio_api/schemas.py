"""Typed API contracts. These models are the authoritative local API schema."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

TaskType = Literal["music", "sfx", "ambient"]
JobStatus = Literal["queued", "running", "completed", "failed", "cancelled"]
AssetOrigin = Literal["generated", "imported", "edited", "rendered"]
MediaType = Literal["music", "sfx", "ambient", "voice", "other"]


class ErrorBody(BaseModel):
    code: str
    message: str
    details: dict[str, Any] = Field(default_factory=dict)
    remediation: str | None = None
    request_id: str


class ErrorResponse(BaseModel):
    error: ErrorBody


class GpuInfo(BaseModel):
    index: int
    name: str
    backend: str
    total_vram_mb: int | None = None
    free_vram_mb: int | None = None
    driver: str | None = None


class SystemInfo(BaseModel):
    app_version: str
    platform: str
    platform_release: str
    architecture: str
    cpu_model: str
    cpu_count: int
    ram_total_mb: int | None
    ram_available_mb: int | None
    gpus: list[GpuInfo]
    available_backends: list[str]
    recommended_backend: str
    data_dir: str
    ffmpeg_available: bool
    ffmpeg_version: str | None
    ffprobe_available: bool
    python_version: str
    storage_free_gb: float | None
    warnings: list[str]


class RuntimeSettingsResponse(BaseModel):
    language: str
    theme: str
    default_export_format: str
    default_sample_rate: int
    max_concurrent_jobs: int
    gpu_preference: str
    onboarding_complete: bool
    default_project_dir: str | None
    reduce_motion: bool
    telemetry: bool
    last_seen_version: str | None
    model_license_acknowledgements: dict[str, str]


class RuntimeSettingsUpdate(BaseModel):
    # Unknown fields are rejected instead of silently ignored. This keeps the
    # local-only guarantee explicit: a client cannot opt into telemetry or any
    # other field the service does not support.
    model_config = ConfigDict(extra="forbid")

    language: str | None = None
    theme: str | None = None
    default_export_format: str | None = None
    default_sample_rate: int | None = None
    max_concurrent_jobs: int | None = None
    gpu_preference: str | None = None
    onboarding_complete: bool | None = None
    default_project_dir: str | None = None
    reduce_motion: bool | None = None
    model_license_acknowledgements: dict[str, str] | None = None


class ModelCapability(BaseModel):
    task: TaskType
    supported_parameters: list[str]
    duration_min: float
    duration_max: float
    supports_negative_prompt: bool = False
    supports_seed: bool = True
    supports_variations: bool = True
    supports_loop: bool = False
    max_variations: int = 4


class ModelInfo(BaseModel):
    id: str
    name: str
    family: str
    description: str
    tasks: list[TaskType]
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
    commercial_use: Literal["permitted", "prohibited", "unclear", "varies"]
    redistribution: Literal["permitted", "prohibited", "unclear", "varies"]
    bundling: Literal["builtin", "user-download"]
    known_limitations: list[str]
    builtin: bool
    installed: bool
    availability: Literal["ready", "installed-missing-deps", "not-installed", "unsupported"]
    availability_detail: str | None = None
    requires_license_acknowledgement: bool
    license_acknowledged: bool
    gated: bool = False
    installed_path: str | None = None


class ModelInstallRequest(BaseModel):
    accept_license: bool
    version: str | None = None


class DownloadInfo(BaseModel):
    id: str
    model_id: str
    status: Literal["queued", "running", "completed", "failed", "cancelled"]
    progress: float
    total_bytes: int | None
    downloaded_bytes: int
    current_file: str | None
    error: str | None
    created_at: str
    finished_at: str | None


class GenerationParams(BaseModel):
    tempo: int | None = Field(default=None, ge=20, le=300)
    musical_key: str | None = None
    mood: str | None = None
    style: str | None = None
    instrumental: bool | None = None
    loop: bool = False
    quality: Literal["fast", "balanced", "high"] = "balanced"
    guidance: float | None = Field(default=None, ge=0.0, le=20.0)
    steps: int | None = Field(default=None, ge=1, le=500)
    extra: dict[str, Any] = Field(default_factory=dict)


class GenerationRequest(BaseModel):
    model_id: str
    task: TaskType
    prompt: str = Field(min_length=2, max_length=2000)
    negative_prompt: str = Field(default="", max_length=2000)
    duration: float = Field(default=8.0, ge=1.0, le=300.0)
    seed: int | None = Field(default=None, ge=0, le=4_294_967_295)
    variations: int = Field(default=1, ge=1, le=4)
    params: GenerationParams = Field(default_factory=GenerationParams)

    @field_validator("prompt")
    @classmethod
    def _prompt_not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("prompt must not be blank")
        return value.strip()


class JobInfo(BaseModel):
    id: str
    model_id: str
    task: TaskType
    prompt: str
    negative_prompt: str
    status: JobStatus
    progress: float | None
    progress_label: str | None
    created_at: str
    started_at: str | None
    finished_at: str | None
    error: dict[str, Any] | None
    output_asset_ids: list[str]
    seed: int | None
    requested_variations: int
    retry_of: str | None
    backend: str | None
    duration_requested: float
    params: dict[str, Any]


class HardwareWarning(BaseModel):
    level: Literal["info", "warning", "blocking"]
    message: str


class JobCreateResponse(BaseModel):
    jobs: list[JobInfo]
    warnings: list[HardwareWarning]


class AssetInfo(BaseModel):
    id: str
    name: str
    origin: AssetOrigin
    media_type: MediaType
    duration: float
    sample_rate: int
    channels: int
    format: str
    size_bytes: int
    created_at: str
    updated_at: str
    source_job_id: str | None
    parent_asset_id: str | None
    favorite: bool
    notes: str
    tags: list[str]
    file_url: str


class AssetUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    favorite: bool | None = None
    notes: str | None = Field(default=None, max_length=4000)
    media_type: MediaType | None = None
    tags: list[str] | None = None


class AssetListResponse(BaseModel):
    items: list[AssetInfo]
    total: int


class WaveformResponse(BaseModel):
    asset_id: str
    duration: float
    channels: int
    peaks: list[list[float]]
    sample_rate: int


class AudioOperationRequest(BaseModel):
    operation: Literal[
        "trim",
        "silence",
        "fade_in",
        "fade_out",
        "gain",
        "normalize",
        "reverse",
        "loop",
        "split",
        "duplicate",
    ]
    start: float | None = Field(default=None, ge=0)
    end: float | None = Field(default=None, ge=0)
    amount: float | None = None
    duration: float | None = Field(default=None, gt=0, le=60)
    crossfade: float | None = Field(default=None, ge=0, le=10)
    name: str | None = None


class AudioOperationResponse(BaseModel):
    assets: list[AssetInfo]
    description: str


class JoinRequest(BaseModel):
    asset_ids: list[str] = Field(min_length=1, max_length=50)
    crossfade: float = Field(default=0.0, ge=0.0, le=10.0)
    name: str | None = None


class EffectSpec(BaseModel):
    type: Literal["eq", "compressor", "limiter", "reverb", "delay"]
    enabled: bool = True
    params: dict[str, float] = Field(default_factory=dict)


class ClipSpec(BaseModel):
    id: str
    asset_id: str
    start: float = Field(ge=0)
    offset: float = Field(default=0.0, ge=0)
    duration: float = Field(gt=0)
    fade_in: float = Field(default=0.0, ge=0)
    fade_out: float = Field(default=0.0, ge=0)
    gain: float = Field(default=1.0, ge=0, le=4)


class TrackSpec(BaseModel):
    id: str
    name: str
    volume: float = Field(default=1.0, ge=0, le=4)
    pan: float = Field(default=0.0, ge=-1, le=1)
    mute: bool = False
    solo: bool = False
    clips: list[ClipSpec] = Field(default_factory=list)


class MasterSpec(BaseModel):
    volume: float = Field(default=1.0, ge=0, le=4)
    effects: list[EffectSpec] = Field(default_factory=list)
    normalize: bool = False


class ProjectDocument(BaseModel):
    version: int = 1
    id: str
    name: str
    sample_rate: int = 44100
    bpm: float | None = None
    tracks: list[TrackSpec] = Field(default_factory=list)
    master: MasterSpec = Field(default_factory=MasterSpec)
    created_at: str
    updated_at: str
    notes: str = ""


class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    sample_rate: int = 44100


class ProjectUpdate(BaseModel):
    document: ProjectDocument
    autosave: bool = False


class ProjectSummary(BaseModel):
    id: str
    name: str
    track_count: int
    duration: float
    created_at: str
    updated_at: str
    has_autosave: bool


class ProjectInfo(ProjectSummary):
    document: ProjectDocument


class RenderRequest(BaseModel):
    format: str = "wav"
    sample_rate: int | None = None
    bit_depth: int | None = None
    normalize: bool = True
    master_effects: bool = True


class ExportFormatOption(BaseModel):
    id: str
    label: str
    container: str
    codecs: list[str]
    supports_bitrate: bool
    supports_bit_depth: bool
    supports_sample_rate: bool
    available: bool
    reason: str | None = None
    extension: str


class ExportCapabilities(BaseModel):
    ffmpeg_available: bool
    ffmpeg_version: str | None
    formats: list[ExportFormatOption]
    encoders: list[str]


class ExportRequest(BaseModel):
    asset_id: str
    format: str
    bitrate_kbps: int | None = Field(default=None, ge=32, le=512)
    sample_rate: int | None = None
    bit_depth: int | None = None
    channels: int | None = Field(default=None, ge=1, le=2)
    filename: str | None = None
    normalize_peak_db: float | None = Field(default=None, ge=-24, le=0)
    dither: bool = False


class ExportResult(BaseModel):
    id: str
    format: str
    path: str
    size_bytes: int
    verified: bool
    duration: float | None
    message: str


class HealthResponse(BaseModel):
    status: Literal["ok"]
    version: str
    database_version: int
    uptime_seconds: float
    local_only: bool


class OpenFolderRequest(BaseModel):
    kind: Literal["data", "exports", "models"]


class OpenFolderResponse(BaseModel):
    opened: bool
    path: str
