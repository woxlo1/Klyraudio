"""Typed API contracts. These models are the authoritative local API schema."""

from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field, field_validator

TaskType = Literal["music", "sfx", "ambient"]
JobStatus = Literal["queued", "running", "completed", "failed", "cancelled"]
AssetOrigin = Literal["generated", "imported", "edited", "rendered"]
MediaType = Literal["music", "sfx", "ambient", "voice", "other"]


class ErrorBody(BaseModel):
    code: str
    message: str
    details: Dict[str, Any] = Field(default_factory=dict)
    remediation: Optional[str] = None
    request_id: str


class ErrorResponse(BaseModel):
    error: ErrorBody


class GpuInfo(BaseModel):
    index: int
    name: str
    backend: str
    total_vram_mb: Optional[int] = None
    free_vram_mb: Optional[int] = None
    driver: Optional[str] = None


class SystemInfo(BaseModel):
    app_version: str
    platform: str
    platform_release: str
    architecture: str
    cpu_model: str
    cpu_count: int
    ram_total_mb: Optional[int]
    ram_available_mb: Optional[int]
    gpus: List[GpuInfo]
    available_backends: List[str]
    recommended_backend: str
    data_dir: str
    ffmpeg_available: bool
    ffmpeg_version: Optional[str]
    ffprobe_available: bool
    python_version: str
    storage_free_gb: Optional[float]
    warnings: List[str]


class RuntimeSettingsResponse(BaseModel):
    language: str
    theme: str
    default_export_format: str
    default_sample_rate: int
    max_concurrent_jobs: int
    gpu_preference: str
    onboarding_complete: bool
    default_project_dir: Optional[str]
    reduce_motion: bool
    telemetry: bool
    last_seen_version: Optional[str]
    model_license_acknowledgements: Dict[str, str]


class RuntimeSettingsUpdate(BaseModel):
    language: Optional[str] = None
    theme: Optional[str] = None
    default_export_format: Optional[str] = None
    default_sample_rate: Optional[int] = None
    max_concurrent_jobs: Optional[int] = None
    gpu_preference: Optional[str] = None
    onboarding_complete: Optional[bool] = None
    default_project_dir: Optional[str] = None
    reduce_motion: Optional[bool] = None
    model_license_acknowledgements: Optional[Dict[str, str]] = None


class ModelCapability(BaseModel):
    task: TaskType
    supported_parameters: List[str]
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
    tasks: List[TaskType]
    capabilities: List[ModelCapability]
    runtime: List[str]
    operating_systems: List[str]
    acceleration: List[str]
    vram_estimate_mb: Optional[int]
    ram_estimate_mb: Optional[int]
    size_bytes: Optional[int]
    source_url: str
    license_name: str
    license_url: str
    commercial_use: Literal["permitted", "prohibited", "unclear", "varies"]
    redistribution: Literal["permitted", "prohibited", "unclear", "varies"]
    bundling: Literal["builtin", "user-download"]
    known_limitations: List[str]
    builtin: bool
    installed: bool
    availability: Literal["ready", "installed-missing-deps", "not-installed", "unsupported"]
    availability_detail: Optional[str] = None
    requires_license_acknowledgement: bool
    license_acknowledged: bool
    gated: bool = False
    installed_path: Optional[str] = None


class ModelInstallRequest(BaseModel):
    accept_license: bool
    version: Optional[str] = None


class DownloadInfo(BaseModel):
    id: str
    model_id: str
    status: Literal["queued", "running", "completed", "failed", "cancelled"]
    progress: float
    total_bytes: Optional[int]
    downloaded_bytes: int
    current_file: Optional[str]
    error: Optional[str]
    created_at: str
    finished_at: Optional[str]


class GenerationParams(BaseModel):
    tempo: Optional[int] = Field(default=None, ge=20, le=300)
    musical_key: Optional[str] = None
    mood: Optional[str] = None
    style: Optional[str] = None
    instrumental: Optional[bool] = None
    loop: bool = False
    quality: Literal["fast", "balanced", "high"] = "balanced"
    guidance: Optional[float] = Field(default=None, ge=0.0, le=20.0)
    steps: Optional[int] = Field(default=None, ge=1, le=500)
    extra: Dict[str, Any] = Field(default_factory=dict)


class GenerationRequest(BaseModel):
    model_id: str
    task: TaskType
    prompt: str = Field(min_length=2, max_length=2000)
    negative_prompt: str = Field(default="", max_length=2000)
    duration: float = Field(default=8.0, ge=1.0, le=300.0)
    seed: Optional[int] = Field(default=None, ge=0, le=4_294_967_295)
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
    progress: Optional[float]
    progress_label: Optional[str]
    created_at: str
    started_at: Optional[str]
    finished_at: Optional[str]
    error: Optional[Dict[str, Any]]
    output_asset_ids: List[str]
    seed: Optional[int]
    requested_variations: int
    retry_of: Optional[str]
    backend: Optional[str]
    duration_requested: float
    params: Dict[str, Any]


class HardwareWarning(BaseModel):
    level: Literal["info", "warning", "blocking"]
    message: str


class JobCreateResponse(BaseModel):
    jobs: List[JobInfo]
    warnings: List[HardwareWarning]


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
    source_job_id: Optional[str]
    parent_asset_id: Optional[str]
    favorite: bool
    notes: str
    tags: List[str]
    file_url: str


class AssetUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    favorite: Optional[bool] = None
    notes: Optional[str] = Field(default=None, max_length=4000)
    media_type: Optional[MediaType] = None
    tags: Optional[List[str]] = None


class AssetListResponse(BaseModel):
    items: List[AssetInfo]
    total: int


class WaveformResponse(BaseModel):
    asset_id: str
    duration: float
    channels: int
    peaks: List[List[float]]
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
    start: Optional[float] = Field(default=None, ge=0)
    end: Optional[float] = Field(default=None, ge=0)
    amount: Optional[float] = None
    duration: Optional[float] = Field(default=None, gt=0, le=60)
    crossfade: Optional[float] = Field(default=None, ge=0, le=10)
    name: Optional[str] = None


class AudioOperationResponse(BaseModel):
    assets: List[AssetInfo]
    description: str


class JoinRequest(BaseModel):
    asset_ids: List[str] = Field(min_length=1, max_length=50)
    crossfade: float = Field(default=0.0, ge=0.0, le=10.0)
    name: Optional[str] = None


class EffectSpec(BaseModel):
    type: Literal["eq", "compressor", "limiter", "reverb", "delay"]
    enabled: bool = True
    params: Dict[str, float] = Field(default_factory=dict)


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
    clips: List[ClipSpec] = Field(default_factory=list)


class MasterSpec(BaseModel):
    volume: float = Field(default=1.0, ge=0, le=4)
    effects: List[EffectSpec] = Field(default_factory=list)
    normalize: bool = False


class ProjectDocument(BaseModel):
    version: int = 1
    id: str
    name: str
    sample_rate: int = 44100
    bpm: Optional[float] = None
    tracks: List[TrackSpec] = Field(default_factory=list)
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
    sample_rate: Optional[int] = None
    bit_depth: Optional[int] = None
    normalize: bool = True
    master_effects: bool = True


class ExportFormatOption(BaseModel):
    id: str
    label: str
    container: str
    codecs: List[str]
    supports_bitrate: bool
    supports_bit_depth: bool
    supports_sample_rate: bool
    available: bool
    reason: Optional[str] = None
    extension: str


class ExportCapabilities(BaseModel):
    ffmpeg_available: bool
    ffmpeg_version: Optional[str]
    formats: List[ExportFormatOption]
    encoders: List[str]


class ExportRequest(BaseModel):
    asset_id: str
    format: str
    bitrate_kbps: Optional[int] = Field(default=None, ge=32, le=512)
    sample_rate: Optional[int] = None
    bit_depth: Optional[int] = None
    channels: Optional[int] = Field(default=None, ge=1, le=2)
    filename: Optional[str] = None
    normalize_peak_db: Optional[float] = Field(default=None, ge=-24, le=0)
    dither: bool = False


class ExportResult(BaseModel):
    id: str
    format: str
    path: str
    size_bytes: int
    verified: bool
    duration: Optional[float]
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
