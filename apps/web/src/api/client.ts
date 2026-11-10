import type {
  AssetInfo,
  AssetListResponse,
  AssetQuery,
  AssetUpdate,
  AudioOperationRequest,
  AudioOperationResponse,
  DownloadInfo,
  ExportCapabilities,
  ExportRecord,
  ExportRequest,
  ExportResult,
  GenerationRequest,
  HealthResponse,
  JobCreateResponse,
  JobInfo,
  JoinRequest,
  MediaType,
  ModelInfo,
  ProjectCreate,
  ProjectInfo,
  ProjectSummary,
  ProjectUpdate,
  RenderRequest,
  RuntimeSettings,
  RuntimeSettingsUpdate,
  StorageInfo,
  SystemInfo,
  TagCount,
  WaveformResponse,
} from "./types";

export const API_BASE = "/api";

export class ApiError extends Error {
  readonly code: string;
  readonly details: Record<string, unknown>;
  readonly remediation?: string | null;
  readonly requestId?: string;
  readonly status: number;

  constructor(options: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
    remediation?: string | null;
    requestId?: string;
    status: number;
  }) {
    super(options.message);
    this.name = "ApiError";
    this.code = options.code;
    this.details = options.details ?? {};
    this.remediation = options.remediation;
    this.requestId = options.requestId;
    this.status = options.status;
  }

  get isOffline(): boolean {
    return this.code === "network_error";
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  timeoutMs?: number;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, headers = {}, signal, timeoutMs = 45000 } = options;
  const controller = new AbortController();
  const relayAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", relayAbort, { once: true });
  }
  const timer = timeoutMs > 0 ? window.setTimeout(() => controller.abort(), timeoutMs) : undefined;
  try {
    const init: RequestInit = {
      method,
      signal: controller.signal,
      headers: { Accept: "application/json", ...headers },
    };
    if (body !== undefined && !(body instanceof FormData)) {
      init.headers = { ...init.headers, "Content-Type": "application/json" };
      init.body = JSON.stringify(body);
    } else if (body instanceof FormData) {
      init.body = body;
    }
    const response = await fetch(`${API_BASE}${path}`, init);
    if (response.status === 204) {
      return undefined as T;
    }
    const text = await response.text();
    let payload: unknown = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = null;
      }
    }
    if (!response.ok) {
      const envelope = payload as { error?: Record<string, unknown> } | null;
      const error = envelope?.error;
      throw new ApiError({
        code: typeof error?.code === "string" ? error.code : `http_${response.status}`,
        message:
          typeof error?.message === "string"
            ? error.message
            : `The local service returned HTTP ${response.status}.`,
        details:
          error && typeof error.details === "object" && error.details !== null
            ? (error.details as Record<string, unknown>)
            : {},
        remediation: typeof error?.remediation === "string" ? error.remediation : null,
        requestId: typeof error?.request_id === "string" ? error.request_id : undefined,
        status: response.status,
      });
    }
    return payload as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ApiError({
        code: "network_error",
        message: "The request to the local Klyraudio service timed out.",
        status: 0,
      });
    }
    throw new ApiError({
      code: "network_error",
      message: "Could not reach the local Klyraudio service.",
      status: 0,
    });
  } finally {
    if (timer) window.clearTimeout(timer);
    if (signal) signal.removeEventListener("abort", relayAbort);
  }
}

function queryString(values: Record<string, string | number | boolean | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === "") continue;
    params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : "";
}

export const api = {
  health: () => request<HealthResponse>("/health", { timeoutMs: 5000 }),
  systemInfo: () => request<SystemInfo>("/system/info"),
  storage: () => request<StorageInfo>("/storage"),

  getSettings: () => request<RuntimeSettings>("/settings"),
  updateSettings: (update: RuntimeSettingsUpdate) =>
    request<RuntimeSettings>("/settings", { method: "PATCH", body: update }),

  models: () => request<ModelInfo[]>("/models"),
  model: (modelId: string) => request<ModelInfo>(`/models/${encodeURIComponent(modelId)}`),
  installModel: (modelId: string, acceptLicense: boolean) =>
    request<DownloadInfo>(`/models/${encodeURIComponent(modelId)}/install`, {
      method: "POST",
      body: { accept_license: acceptLicense },
      timeoutMs: 120000,
    }),
  acknowledgeLicense: (modelId: string) =>
    request<ModelInfo>(`/models/${encodeURIComponent(modelId)}/acknowledge-license`, {
      method: "POST",
    }),
  downloads: () => request<DownloadInfo[]>("/models/downloads"),
  cancelDownload: (downloadId: string) =>
    request<DownloadInfo>(`/models/downloads/${encodeURIComponent(downloadId)}/cancel`, {
      method: "POST",
    }),
  removeModel: (modelId: string) =>
    request<{ removed: boolean }>(`/models/${encodeURIComponent(modelId)}`, { method: "DELETE" }),

  generate: (payload: GenerationRequest) =>
    request<JobCreateResponse>("/generations", { method: "POST", body: payload }),
  jobs: (status?: string) => request<JobInfo[]>(`/jobs${queryString({ status })}`),
  job: (jobId: string) => request<JobInfo>(`/jobs/${encodeURIComponent(jobId)}`),
  cancelJob: (jobId: string) =>
    request<JobInfo>(`/jobs/${encodeURIComponent(jobId)}/cancel`, { method: "POST" }),
  retryJob: (jobId: string) =>
    request<JobInfo>(`/jobs/${encodeURIComponent(jobId)}/retry`, { method: "POST" }),
  deleteJob: (jobId: string) =>
    request<{ deleted: boolean }>(`/jobs/${encodeURIComponent(jobId)}`, { method: "DELETE" }),

  assets: (query: AssetQuery = {}) =>
    request<AssetListResponse>(`/assets${queryString(query as Record<string, string | number | boolean | undefined>)}`),
  asset: (assetId: string) => request<AssetInfo>(`/assets/${encodeURIComponent(assetId)}`),
  assetTags: () => request<TagCount[]>("/assets/tags"),
  updateAsset: (assetId: string, update: AssetUpdate) =>
    request<AssetInfo>(`/assets/${encodeURIComponent(assetId)}`, {
      method: "PATCH",
      body: update,
    }),
  deleteAsset: (assetId: string, deleteFile = true) =>
    request<{ deleted: boolean }>(
      `/assets/${encodeURIComponent(assetId)}${queryString({ delete_file: deleteFile })}`,
      { method: "DELETE" },
    ),
  importAsset: (file: File, mediaType: MediaType = "other") => {
    const form = new FormData();
    form.append("file", file);
    form.append("media_type", mediaType);
    return request<AssetInfo>("/assets/import", {
      method: "POST",
      body: form,
      timeoutMs: 0,
    });
  },
  joinAssets: (payload: JoinRequest) =>
    request<AudioOperationResponse>("/assets/join", { method: "POST", body: payload }),
  operate: (assetId: string, payload: AudioOperationRequest) =>
    request<AudioOperationResponse>(`/assets/${encodeURIComponent(assetId)}/operations`, {
      method: "POST",
      body: payload,
      timeoutMs: 120000,
    }),
  waveform: (assetId: string, points = 900) =>
    request<WaveformResponse>(
      `/assets/${encodeURIComponent(assetId)}/waveform${queryString({ points })}`,
    ),
  audioUrl: (assetId: string) => `${API_BASE}/assets/${encodeURIComponent(assetId)}/audio`,

  projects: () => request<ProjectSummary[]>("/projects"),
  createProject: (payload: ProjectCreate) =>
    request<ProjectInfo>("/projects", { method: "POST", body: payload }),
  project: (projectId: string) => request<ProjectInfo>(`/projects/${encodeURIComponent(projectId)}`),
  updateProject: (projectId: string, payload: ProjectUpdate) =>
    request<ProjectInfo>(`/projects/${encodeURIComponent(projectId)}`, {
      method: "PUT",
      body: payload,
      timeoutMs: 60000,
    }),
  deleteProject: (projectId: string) =>
    request<{ deleted: boolean }>(`/projects/${encodeURIComponent(projectId)}`, {
      method: "DELETE",
    }),
  renderProject: (projectId: string, payload: RenderRequest = {}) =>
    request<AssetInfo>(`/projects/${encodeURIComponent(projectId)}/render`, {
      method: "POST",
      body: payload,
      timeoutMs: 300000,
    }),

  exportCapabilities: () => request<ExportCapabilities>("/export/capabilities"),
  exportAudio: (payload: ExportRequest) =>
    request<ExportResult>("/export", { method: "POST", body: payload, timeoutMs: 300000 }),
  exportHistory: (limit = 50) =>
    request<ExportRecord[]>(`/export/history${queryString({ limit })}`),
  exportFolder: () => request<{ path: string }>("/export/folder"),
};

export type Api = typeof api;
