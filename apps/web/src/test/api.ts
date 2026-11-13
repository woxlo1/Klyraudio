import { vi } from "vitest";
import { api } from "../api/client";
import {
  makeAsset,
  makeExportCapabilities,
  makeHealth,
  makeJob,
  makeModel,
  makeProjectInfo,
  makeSettings,
  makeStorage,
  makeSystemInfo,
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
    downloads: vi.spyOn(api, "downloads").mockResolvedValue([]),
    jobs: vi.spyOn(api, "jobs").mockResolvedValue([]),
    job: vi.spyOn(api, "job").mockResolvedValue(makeJob()),
    generate: vi.spyOn(api, "generate").mockResolvedValue({ jobs: [makeJob()], warnings: [] }),
    cancelJob: vi.spyOn(api, "cancelJob").mockResolvedValue(makeJob()),
    retryJob: vi.spyOn(api, "retryJob").mockResolvedValue(makeJob()),
    deleteJob: vi.spyOn(api, "deleteJob").mockResolvedValue({ deleted: true }),
    assets: vi.spyOn(api, "assets").mockResolvedValue({ items: [], total: 0 }),
    asset: vi.spyOn(api, "asset").mockResolvedValue(makeAsset()),
    assetTags: vi.spyOn(api, "assetTags").mockResolvedValue([]),
    openFolder: vi.spyOn(api, "openFolder").mockResolvedValue({ opened: true, path: "" }),
    projects: vi.spyOn(api, "projects").mockResolvedValue([]),
    createProject: vi.spyOn(api, "createProject").mockResolvedValue(makeProjectInfo()),
    updateProject: vi.spyOn(api, "updateProject").mockResolvedValue(makeProjectInfo()),
    exportCapabilities: vi
      .spyOn(api, "exportCapabilities")
      .mockResolvedValue(makeExportCapabilities()),
    exportFolder: vi.spyOn(api, "exportFolder").mockResolvedValue({ path: "" }),
  };
}

export type ApiSpies = ReturnType<typeof mockApi>;
