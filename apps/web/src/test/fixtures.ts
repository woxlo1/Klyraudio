import type {
  AssetInfo,
  DownloadInfo,
  ExportCapabilities,
  HealthResponse,
  JobInfo,
  ModelCapability,
  ModelInfo,
  ProjectDocument,
  ProjectInfo,
  RuntimeSettings,
  StorageInfo,
  SystemInfo,
} from "../api/types";

/**
 * Typed factories for API response fixtures used by the page tests. Every
 * factory accepts partial overrides so a test only spells out the fields it
 * cares about, and defaults describe a healthy local service.
 */

const ISO_TIMESTAMP = "2026-01-01T12:00:00.000Z";

export const DATA_DIR = "/home/tester/Klyraudio";
export const EXPORT_DIR = "/home/tester/Klyraudio/exports";

export function makeHealth(overrides: Partial<HealthResponse> = {}): HealthResponse {
  return {
    status: "ok",
    version: "0.1.0",
    database_version: 1,
    uptime_seconds: 60,
    local_only: true,
    ...overrides,
  };
}

export function makeSystemInfo(overrides: Partial<SystemInfo> = {}): SystemInfo {
  return {
    app_version: "0.1.0",
    platform: "TestOS",
    platform_release: "1.0",
    architecture: "x86_64",
    cpu_model: "Test CPU",
    cpu_count: 8,
    ram_total_mb: 16384,
    ram_available_mb: 8192,
    gpus: [
      {
        index: 0,
        name: "Test GPU",
        backend: "cuda",
        total_vram_mb: 8192,
        free_vram_mb: 4096,
        driver: "1.0",
      },
    ],
    available_backends: ["cpu", "cuda"],
    recommended_backend: "cuda",
    data_dir: DATA_DIR,
    ffmpeg_available: true,
    ffmpeg_version: "6.0",
    ffprobe_available: true,
    python_version: "3.13.0",
    storage_free_gb: 120.5,
    warnings: [],
    ...overrides,
  };
}

export function makeSettings(overrides: Partial<RuntimeSettings> = {}): RuntimeSettings {
  return {
    language: "en",
    theme: "dark",
    default_export_format: "wav",
    default_sample_rate: 44100,
    max_concurrent_jobs: 1,
    gpu_preference: "auto",
    onboarding_complete: true,
    default_project_dir: null,
    reduce_motion: false,
    telemetry: false,
    last_seen_version: null,
    model_license_acknowledgements: {},
    ...overrides,
  };
}

export function makeStorage(overrides: Partial<StorageInfo> = {}): StorageInfo {
  return {
    data_dir: DATA_DIR,
    managed_bytes: 1048576,
    ...overrides,
  };
}

const SKETCH_CAPABILITIES: ModelCapability[] = [
  {
    task: "music",
    supported_parameters: ["tempo", "musical_key", "mood", "style", "instrumental"],
    duration_min: 1,
    duration_max: 120,
    supports_negative_prompt: false,
    supports_seed: true,
    supports_variations: true,
    supports_loop: false,
    max_variations: 4,
  },
  {
    task: "sfx",
    supported_parameters: ["mood", "style"],
    duration_min: 1,
    duration_max: 30,
    supports_negative_prompt: false,
    supports_seed: true,
    supports_variations: true,
    supports_loop: false,
    max_variations: 4,
  },
  {
    task: "ambient",
    supported_parameters: ["mood", "style", "loop"],
    duration_min: 5,
    duration_max: 300,
    supports_negative_prompt: false,
    supports_seed: true,
    supports_variations: true,
    supports_loop: false,
    max_variations: 4,
  },
];

export function makeModel(overrides: Partial<ModelInfo> = {}): ModelInfo {
  return {
    id: "klyraudio-sketch",
    name: "Klyraudio Sketch",
    family: "sketch",
    description: "Built-in DSP synthesizer for music, effects, and ambience.",
    tasks: ["music", "sfx", "ambient"],
    capabilities: SKETCH_CAPABILITIES,
    runtime: ["builtin"],
    operating_systems: ["windows", "macos", "linux"],
    acceleration: ["cpu"],
    vram_estimate_mb: 0,
    ram_estimate_mb: 256,
    size_bytes: 0,
    source_url: "https://example.com/klyraudio-sketch",
    license_name: "GPL-3.0",
    license_url: "https://www.gnu.org/licenses/gpl-3.0.html",
    commercial_use: "permitted",
    redistribution: "permitted",
    bundling: "builtin",
    known_limitations: ["Rule-based DSP, not a neural model."],
    builtin: true,
    installed: true,
    availability: "ready",
    availability_detail: null,
    requires_license_acknowledgement: false,
    license_acknowledged: false,
    gated: false,
    installed_path: null,
    ...overrides,
  };
}

export function makeNeuralModel(overrides: Partial<ModelInfo> = {}): ModelInfo {
  return makeModel({
    id: "musicgen-small",
    name: "MusicGen Small",
    family: "musicgen",
    description: "A compact text-to-music model.",
    tasks: ["music"],
    capabilities: [
      {
        task: "music",
        supported_parameters: [],
        duration_min: 1,
        duration_max: 30,
        supports_negative_prompt: false,
        supports_seed: true,
        supports_variations: true,
        supports_loop: false,
        max_variations: 4,
      },
    ],
    runtime: ["pytorch"],
    operating_systems: ["windows", "macos", "linux"],
    acceleration: ["cuda", "mps", "cpu"],
    vram_estimate_mb: 4096,
    ram_estimate_mb: 8192,
    size_bytes: 2621440000,
    source_url: "https://huggingface.co/facebook/musicgen-small",
    license_name: "CC BY-NC 4.0",
    license_url: "https://creativecommons.org/licenses/by-nc/4.0/",
    commercial_use: "prohibited",
    redistribution: "varies",
    bundling: "user-download",
    known_limitations: ["Instrumental music only."],
    builtin: false,
    installed: true,
    availability: "ready",
    requires_license_acknowledgement: true,
    license_acknowledged: true,
    ...overrides,
  });
}

export function makeJob(overrides: Partial<JobInfo> = {}): JobInfo {
  return {
    id: "job-1",
    model_id: "klyraudio-sketch",
    task: "sfx",
    prompt: "Soft confirmation chime",
    negative_prompt: "",
    status: "completed",
    progress: null,
    progress_label: null,
    created_at: ISO_TIMESTAMP,
    started_at: ISO_TIMESTAMP,
    finished_at: ISO_TIMESTAMP,
    error: null,
    output_asset_ids: ["asset-1"],
    seed: 1234,
    requested_variations: 1,
    retry_of: null,
    backend: "cpu",
    duration_requested: 3,
    params: {},
    ...overrides,
  };
}

export function makeAsset(overrides: Partial<AssetInfo> = {}): AssetInfo {
  return {
    id: "asset-1",
    name: "Test chime.wav",
    origin: "generated",
    media_type: "sfx",
    duration: 3.5,
    sample_rate: 44100,
    channels: 2,
    format: "wav",
    size_bytes: 616000,
    created_at: ISO_TIMESTAMP,
    updated_at: ISO_TIMESTAMP,
    source_job_id: "job-1",
    parent_asset_id: null,
    favorite: false,
    notes: "",
    tags: [],
    file_url: "/api/assets/asset-1/audio",
    ...overrides,
  };
}

export function makeDownloadInfo(overrides: Partial<DownloadInfo> = {}): DownloadInfo {
  return {
    id: "download-1",
    model_id: "musicgen-small",
    status: "running",
    progress: 0.4,
    total_bytes: 2621440000,
    downloaded_bytes: 1048576000,
    current_file: "model.safetensors",
    error: null,
    created_at: ISO_TIMESTAMP,
    finished_at: null,
    ...overrides,
  };
}

function makeDocument(): ProjectDocument {
  return {
    version: 1,
    id: "project-1",
    name: "Test project",
    sample_rate: 44100,
    bpm: null,
    tracks: [],
    master: { volume: 1, effects: [], normalize: false },
    created_at: ISO_TIMESTAMP,
    updated_at: ISO_TIMESTAMP,
    notes: "",
  };
}

export function makeProjectInfo(overrides: Partial<ProjectInfo> = {}): ProjectInfo {
  return {
    id: "project-1",
    name: "Test project",
    track_count: 0,
    duration: 0,
    created_at: ISO_TIMESTAMP,
    updated_at: ISO_TIMESTAMP,
    has_autosave: false,
    document: makeDocument(),
    ...overrides,
  };
}

export function makeExportCapabilities(
  overrides: Partial<ExportCapabilities> = {},
): ExportCapabilities {
  return {
    ffmpeg_available: true,
    ffmpeg_version: "6.0",
    encoders: ["pcm_s16le", "libmp3lame"],
    formats: [
      {
        id: "wav",
        label: "WAV",
        container: "wav",
        codecs: ["pcm_s16le"],
        supports_bitrate: false,
        supports_bit_depth: true,
        supports_sample_rate: true,
        available: true,
        reason: null,
        extension: "wav",
      },
      {
        id: "flac",
        label: "FLAC",
        container: "flac",
        codecs: ["flac"],
        supports_bitrate: false,
        supports_bit_depth: true,
        supports_sample_rate: true,
        available: true,
        reason: null,
        extension: "flac",
      },
      {
        id: "mp3",
        label: "MP3",
        container: "mp3",
        codecs: ["libmp3lame"],
        supports_bitrate: true,
        supports_bit_depth: false,
        supports_sample_rate: true,
        available: true,
        reason: null,
        extension: "mp3",
      },
      {
        id: "ogg",
        label: "Ogg Vorbis",
        container: "ogg",
        codecs: ["libvorbis"],
        supports_bitrate: true,
        supports_bit_depth: false,
        supports_sample_rate: true,
        available: false,
        reason: "The libvorbis encoder is not installed.",
        extension: "ogg",
      },
    ],
    ...overrides,
  };
}
