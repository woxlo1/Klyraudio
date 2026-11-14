import { vi } from "vitest";
import { api } from "../api/client";
import {
  makeAsset,
  makeDownloadInfo,
  makeExportCapabilities,
  makeExportResult,
  makeHealth,
  makeJob,
  makeModel,
  makeProjectInfo,
  makeSettings,
  makeStorage,
  makeSystemInfo,
  makeWaveform,
} from "./fixtures";

/**
 * Replace every API method the pages call with a spy that resolves to a
 * healthy default. Tests override individual spies with `mockResolvedValue*`
 * / `mockRejectedValue*` and assert on calls; `vi.restoreAllMocks()` in an
 * `afterEach` puts the real fetch-based client back.
 */
export function mockApi() {
  return {
    health: vi.spyOn(api, "health").mockResolvedValue(makeHealth()),
    systemInfo: vi.spyOn(api, "systemInfo").mockResolvedValue(makeSystemInfo()),
    storage: vi.spyOn(api, "storage").mockResolvedValue(makeStorage()),
    getSettings: vi.spyOn(api, "getSettings").mockResolvedValue(makeSettings()),
    updateSettings: vi.spyOn(api, "updateSettings").mockResolvedValue(makeSettings()),
    models: vi.spyOn(api, "models").mockResolvedValue([makeModel()]),
    installModel: vi
      .spyOn(api, "installModel")
      .mockResolvedValue(makeDownloadInfo({ status: "queued", progress: 0, current_file: null })),
    downloads: vi.spyOn(api, "downloads").mockResolvedValue([]),
    cancelDownload: vi
      .spyOn(api, "cancelDownload")
      .mockResolvedValue(makeDownloadInfo({ status: "cancelled" })),
    removeModel: vi.spyOn(api, "removeModel").mockResolvedValue({ removed: true }),
    jobs: vi.spyOn(api, "jobs").mockResolvedValue([]),
    job: vi.spyOn(api, "job").mockResolvedValue(makeJob()),
    generate: vi.spyOn(api, "generate").mockResolvedValue({ jobs: [makeJob()], warnings: [] }),
    cancelJob: vi.spyOn(api, "cancelJob").mockResolvedValue(makeJob()),
    retryJob: vi.spyOn(api, "retryJob").mockResolvedValue(makeJob()),
    deleteJob: vi.spyOn(api, "deleteJob").mockResolvedValue({ deleted: true }),
    assets: vi.spyOn(api, "assets").mockResolvedValue({ items: [], total: 0 }),
    asset: vi.spyOn(api, "asset").mockResolvedValue(makeAsset()),
    assetTags: vi.spyOn(api, "assetTags").mockResolvedValue([]),
    updateAsset: vi
      .spyOn(api, "updateAsset")
      .mockImplementation(async (_assetId, update) => makeAsset(update)),
    deleteAsset: vi.spyOn(api, "deleteAsset").mockResolvedValue({ deleted: true }),
    importAsset: vi
      .spyOn(api, "importAsset")
      .mockResolvedValue(makeAsset({ name: "Imported take.wav", origin: "imported" })),
    joinAssets: vi.spyOn(api, "joinAssets").mockResolvedValue({
      assets: [makeAsset({ name: "Joined take.wav" })],
      description: "Joined 2 assets.",
    }),
    audioUrl: vi.spyOn(api, "audioUrl").mockReturnValue("/api/assets/asset-1/audio"),
    waveform: vi.spyOn(api, "waveform").mockResolvedValue(makeWaveform()),
    operate: vi.spyOn(api, "operate").mockResolvedValue({
      assets: [makeAsset({ name: "Edited take.wav", origin: "edited" })],
      description: "Operation applied.",
    }),
    openFolder: vi.spyOn(api, "openFolder").mockResolvedValue({ opened: true, path: "" }),
    projects: vi.spyOn(api, "projects").mockResolvedValue([]),
    createProject: vi.spyOn(api, "createProject").mockResolvedValue(makeProjectInfo()),
    project: vi.spyOn(api, "project").mockResolvedValue(makeProjectInfo()),
    updateProject: vi.spyOn(api, "updateProject").mockResolvedValue(makeProjectInfo()),
    deleteProject: vi.spyOn(api, "deleteProject").mockResolvedValue({ deleted: true }),
    renderProject: vi
      .spyOn(api, "renderProject")
      .mockResolvedValue(makeAsset({ id: "rendered-1", name: "Render.wav", origin: "rendered" })),
    exportCapabilities: vi
      .spyOn(api, "exportCapabilities")
      .mockResolvedValue(makeExportCapabilities()),
    exportAudio: vi.spyOn(api, "exportAudio").mockResolvedValue(makeExportResult()),
    exportFolder: vi.spyOn(api, "exportFolder").mockResolvedValue({ path: "" }),
  };
}

export type ApiSpies = ReturnType<typeof mockApi>;
