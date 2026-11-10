/** Types mirroring the local FastAPI contract in services/api/klyraudio_api/schemas.py. */

export type TaskType = "music" | "sfx" | "ambient";
export type JobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
export type AssetOrigin = "generated" | "imported" | "edited" | "rendered";
export type MediaType = "music" | "sfx" | "ambient" | "voice" | "other";
export type Availability = "ready" | "installed-missing-deps" | "not-installed" | "unsupported";
export type LicenseCommercial = "permitted" | "prohibited" | "unclear" | "varies";

export interface ApiErrorBody {
  code: string;
  message: string;
  details: Record<string, unknown>;
  remediation?: string | null;
  request_id: string;
}

export interface HealthResponse {
  status: "ok";
  version: string;
  database_version: number;
  uptime_seconds: number;
  local_only: boolean;
}

export interface GpuInfo {
  index: number;
  name: string;
  backend: string;
  total_vram_mb: number | null;
  free_vram_mb: number | null;
  driver: string | null;
}

export interface SystemInfo {
  app_version: string;
  platform: string;
  platform_release: string;
  architecture: string;
  cpu_model: string;
  cpu_count: number;
  ram_total_mb: number | null;
  ram_available_mb: number | null;
  gpus: GpuInfo[];
  available_backends: string[];
  recommended_backend: string;
  data_dir: string;
  ffmpeg_available: boolean;
  ffmpeg_version: string | null;
  ffprobe_available: boolean;
  python_version: string;
  storage_free_gb: number | null;
  warnings: string[];
}

export interface RuntimeSettings {
  language: string;
  theme: string;
  default_export_format: string;
  default_sample_rate: number;
  max_concurrent_jobs: number;
  gpu_preference: string;
  onboarding_complete: boolean;
  default_project_dir: string | null;
  reduce_motion: boolean;
  telemetry: boolean;
  last_seen_version: string | null;
  model_license_acknowledgements: Record<string, string>;
}

export type RuntimeSettingsUpdate = Partial<
  Omit<RuntimeSettings, "telemetry" | "last_seen_version">
>;

export interface ModelCapability {
  task: TaskType;
  supported_parameters: string[];
  duration_min: number;
  duration_max: number;
  supports_negative_prompt: boolean;
  supports_seed: boolean;
  supports_variations: boolean;
  supports_loop: boolean;
  max_variations: number;
}

export interface ModelInfo {
  id: string;
  name: string;
  family: string;
  description: string;
  tasks: TaskType[];
  capabilities: ModelCapability[];
  runtime: string[];
  operating_systems: string[];
  acceleration: string[];
  vram_estimate_mb: number | null;
  ram_estimate_mb: number | null;
  size_bytes: number | null;
  source_url: string;
  license_name: string;
  license_url: string;
  commercial_use: LicenseCommercial;
  redistribution: LicenseCommercial;
  bundling: "builtin" | "user-download";
  known_limitations: string[];
  builtin: boolean;
  installed: boolean;
  availability: Availability;
  availability_detail: string | null;
  requires_license_acknowledgement: boolean;
  license_acknowledged: boolean;
  installed_path: string | null;
}

export interface DownloadInfo {
  id: string;
  model_id: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  progress: number;
  total_bytes: number | null;
  downloaded_bytes: number;
  current_file: string | null;
  error: string | null;
  created_at: string;
  finished_at: string | null;
}

export interface GenerationParams {
  tempo?: number | null;
  musical_key?: string | null;
  mood?: string | null;
  style?: string | null;
  instrumental?: boolean | null;
  loop?: boolean;
  quality?: "fast" | "balanced" | "high";
  guidance?: number | null;
  steps?: number | null;
  extra?: Record<string, unknown>;
}

export interface GenerationRequest {
  model_id: string;
  task: TaskType;
  prompt: string;
  negative_prompt?: string;
  duration: number;
  seed?: number | null;
  variations: number;
  params?: GenerationParams;
}

export interface JobInfo {
  id: string;
  model_id: string;
  task: TaskType;
  prompt: string;
  negative_prompt: string;
  status: JobStatus;
  progress: number | null;
  progress_label: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  error: {
    code?: string;
    message?: string;
    details?: Record<string, unknown>;
    remediation?: string | null;
  } | null;
  output_asset_ids: string[];
  seed: number | null;
  requested_variations: number;
  retry_of: string | null;
  backend: string | null;
  duration_requested: number;
  params: Record<string, unknown>;
}

export interface HardwareWarning {
  level: "info" | "warning" | "blocking";
  message: string;
}

export interface JobCreateResponse {
  jobs: JobInfo[];
  warnings: HardwareWarning[];
}

export interface AssetInfo {
  id: string;
  name: string;
  origin: AssetOrigin;
  media_type: MediaType;
  duration: number;
  sample_rate: number;
  channels: number;
  format: string;
  size_bytes: number;
  created_at: string;
  updated_at: string;
  source_job_id: string | null;
  parent_asset_id: string | null;
  favorite: boolean;
  notes: string;
  tags: string[];
  file_url: string;
}

export interface AssetUpdate {
  name?: string;
  favorite?: boolean;
  notes?: string;
  media_type?: MediaType;
  tags?: string[];
}

export interface AssetListResponse {
  items: AssetInfo[];
  total: number;
}

export interface AssetQuery {
  query?: string;
  media_type?: string;
  origin?: string;
  favorite?: boolean;
  tag?: string;
  sort?: string;
  limit?: number;
  offset?: number;
}

export interface TagCount {
  tag: string;
  count: number;
}

export interface WaveformResponse {
  asset_id: string;
  duration: number;
  channels: number;
  peaks: number[][];
  sample_rate: number;
}

export type AudioOperation =
  | "trim"
  | "silence"
  | "fade_in"
  | "fade_out"
  | "gain"
  | "normalize"
  | "reverse"
  | "loop"
  | "split"
  | "duplicate";

export interface AudioOperationRequest {
  operation: AudioOperation;
  start?: number;
  end?: number;
  amount?: number;
  duration?: number;
  crossfade?: number;
  name?: string;
}

export interface AudioOperationResponse {
  assets: AssetInfo[];
  description: string;
}

export interface JoinRequest {
  asset_ids: string[];
  crossfade?: number;
  name?: string;
}

export interface EffectSpec {
  type: "eq" | "compressor" | "limiter" | "reverb" | "delay";
  enabled: boolean;
  params: Record<string, number>;
}

export interface ClipSpec {
  id: string;
  asset_id: string;
  start: number;
  offset: number;
  duration: number;
  fade_in: number;
  fade_out: number;
  gain: number;
}

export interface TrackSpec {
  id: string;
  name: string;
  volume: number;
  pan: number;
  mute: boolean;
  solo: boolean;
  clips: ClipSpec[];
}

export interface MasterSpec {
  volume: number;
  effects: EffectSpec[];
  normalize: boolean;
}

export interface ProjectDocument {
  version: number;
  id: string;
  name: string;
  sample_rate: number;
  bpm: number | null;
  tracks: TrackSpec[];
  master: MasterSpec;
  created_at: string;
  updated_at: string;
  notes: string;
}

export interface ProjectCreate {
  name: string;
  sample_rate?: number;
}

export interface ProjectUpdate {
  document: ProjectDocument;
  autosave?: boolean;
}

export interface ProjectSummary {
  id: string;
  name: string;
  track_count: number;
  duration: number;
  created_at: string;
  updated_at: string;
  has_autosave: boolean;
}

export interface ProjectInfo extends ProjectSummary {
  document: ProjectDocument;
}

export interface RenderRequest {
  format?: string;
  sample_rate?: number | null;
  bit_depth?: number | null;
  normalize?: boolean;
  master_effects?: boolean;
}

export interface ExportFormatOption {
  id: string;
  label: string;
  container: string;
  codecs: string[];
  supports_bitrate: boolean;
  supports_bit_depth: boolean;
  supports_sample_rate: boolean;
  available: boolean;
  reason: string | null;
  extension: string;
}

export interface ExportCapabilities {
  ffmpeg_available: boolean;
  ffmpeg_version: string | null;
  formats: ExportFormatOption[];
  encoders: string[];
}

export interface ExportRequest {
  asset_id: string;
  format: string;
  bitrate_kbps?: number | null;
  sample_rate?: number | null;
  bit_depth?: number | null;
  channels?: number | null;
  filename?: string | null;
  normalize_peak_db?: number | null;
  dither?: boolean;
}

export interface ExportResult {
  id: string;
  format: string;
  path: string;
  size_bytes: number;
  verified: boolean;
  duration: number | null;
  message: string;
}

export interface ExportRecord {
  id: string;
  asset_id: string;
  format: string;
  path: string;
  settings: Record<string, unknown>;
  size_bytes: number;
  created_at: string;
  verified: boolean;
}

export interface StorageInfo {
  data_dir: string;
  managed_bytes: number;
}
