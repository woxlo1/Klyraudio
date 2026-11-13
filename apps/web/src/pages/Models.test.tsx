import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { ApiError } from "../api/client";
import { pageRoutes, renderPage } from "../test/pages";
import { type ApiSpies, mockApi } from "../test/api";
import { makeDownloadInfo, makeModel, makeNeuralModel } from "../test/fixtures";
import { ModelsPage } from "./Models";

const GIB = 1024 ** 3;

function networkError(): ApiError {
  return new ApiError({
    code: "network_error",
    message: "Could not reach the local Klyraudio service.",
    status: 0,
  });
}

function notInstalled(overrides: Parameters<typeof makeNeuralModel>[0] = {}) {
  return makeNeuralModel({
    installed: false,
    availability: "not-installed",
    license_acknowledged: false,
    ...overrides,
  });
}

describe("ModelsPage", () => {
  let apiSpy: ApiSpies;
  let writeText: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    apiSpy = mockApi();
    writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function renderModels() {
    return renderPage(pageRoutes("/models", <ModelsPage />, [{ path: "/" }]), {
      route: "/models",
    });
  }

  async function waitForModels() {
    await screen.findByRole("heading", { level: 1, name: "Model Manager" });
    await waitFor(() => expect(apiSpy.downloads).toHaveBeenCalled());
  }

  it("splits installed and available models", async () => {
    apiSpy.models.mockResolvedValue([
      makeModel(),
      makeNeuralModel({ size_bytes: 2 * GIB }),
      notInstalled({
        id: "stable-audio",
        name: "Stable Audio Open",
        size_bytes: 4 * GIB,
        gated: true,
      }),
    ]);
    renderModels();
    await waitForModels();

    expect(screen.getByRole("heading", { level: 2, name: "Installed models" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "Available models" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 3, name: "Klyraudio Sketch" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 3, name: "MusicGen Small" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 3, name: "Stable Audio Open" })).toBeTruthy();
    expect(screen.getByText("DSP · Not AI")).toBeTruthy();
    expect(screen.getAllByText("Neural model")).toHaveLength(2);
    expect(screen.getByText("Download: 2.00 GB")).toBeTruthy();
    expect(screen.getByText("Download: 4.00 GB")).toBeTruthy();
    expect(screen.getAllByText("Ready").length).toBeGreaterThan(0);
    expect(screen.getByText("Not installed")).toBeTruthy();
  });

  it("shows an empty installed list and no available models", async () => {
    apiSpy.models.mockResolvedValue([makeModel()]);
    renderModels();
    await waitForModels();

    expect(screen.getByText("No models available.")).toBeTruthy();
    expect(screen.queryByRole("heading", { level: 3, name: "MusicGen Small" })).toBeNull();
  });

  it("expands a model card to reveal its requirements and license", async () => {
    renderModels();
    await waitForModels();

    fireEvent.click(screen.getByRole("button", { name: "Details" }));

    expect(screen.getByText("Rule-based DSP, not a neural model.")).toBeTruthy();
    expect(screen.getByText("builtin")).toBeTruthy();
    expect(screen.getByText("windows, macos, linux")).toBeTruthy();
    expect(screen.getAllByText("GPL-3.0").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Less" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Less" }));
    expect(screen.getByRole("button", { name: "Details" })).toBeTruthy();
  });

  it("explains missing runtime packages and copies the install command", async () => {
    apiSpy.models.mockResolvedValue([
      makeModel(),
      makeNeuralModel({
        availability: "installed-missing-deps",
        availability_detail: "PyTorch is not installed for this runtime.",
      }),
    ]);
    renderModels();
    await waitForModels();

    expect(screen.getByText("Dependencies missing")).toBeTruthy();
    expect(screen.getByText("PyTorch is not installed for this runtime.")).toBeTruthy();
    expect(
      screen.getByText("python -m pip install -r services/api/requirements-models.txt"),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Copy command" }));

    expect(writeText).toHaveBeenCalledWith(
      "python -m pip install -r services/api/requirements-models.txt",
    );
    expect(await screen.findByText("Command copied.")).toBeTruthy();
  });

  it("shows the reason a model is unsupported", async () => {
    apiSpy.models.mockResolvedValue([
      makeModel(),
      makeNeuralModel({
        availability: "unsupported",
        availability_detail: "This model needs an NVIDIA GPU.",
        installed: false,
      }),
    ]);
    renderModels();
    await waitForModels();

    expect(screen.getByText("Unsupported")).toBeTruthy();
    expect(screen.getByText("This model needs an NVIDIA GPU.")).toBeTruthy();
  });

  it("requires license acceptance before downloading a gated model", async () => {
    apiSpy.models.mockResolvedValue([
      makeModel(),
      notInstalled({
        id: "stable-audio",
        name: "Stable Audio Open",
        gated: true,
        requires_license_acknowledgement: true,
      }),
    ]);
    renderModels();
    await waitForModels();

    fireEvent.click(screen.getByRole("button", { name: "Download model" }));

    expect(screen.getByRole("dialog", { name: "Install Stable Audio Open" })).toBeTruthy();
    expect(screen.getByText("A Hugging Face account is required")).toBeTruthy();
    expect(screen.getByText("Not permitted by the model license")).toBeTruthy();

    const dialog = screen.getByRole("dialog");
    const download = within(dialog).getByRole("button", {
      name: "Download",
    }) as HTMLButtonElement;
    expect(download.disabled).toBe(true);
    expect(apiSpy.installModel).not.toHaveBeenCalled();

    fireEvent.click(
      within(dialog).getByRole("checkbox", {
        name: "I have reviewed and accept this model's license.",
      }),
    );
    expect(download.disabled).toBe(false);
    fireEvent.click(download);

    await waitFor(() => expect(apiSpy.installModel).toHaveBeenCalledWith("stable-audio", true));
    expect(await screen.findByText("Download started.")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("downloads a model that needs no acknowledgement", async () => {
    apiSpy.models.mockResolvedValue([
      makeModel(),
      notInstalled({
        id: "open-model",
        name: "Open Model",
        requires_license_acknowledgement: false,
      }),
    ]);
    renderModels();
    await waitForModels();

    fireEvent.click(screen.getByRole("button", { name: "Download model" }));
    const dialog = screen.getByRole("dialog", { name: "Install Open Model" });
    expect(within(dialog).queryByRole("checkbox")).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Download" }));

    await waitFor(() => expect(apiSpy.installModel).toHaveBeenCalledWith("open-model", false));
  });

  it("shows active downloads and cancels one", async () => {
    apiSpy.models.mockResolvedValue([makeModel(), makeNeuralModel()]);
    apiSpy.downloads.mockResolvedValue([
      makeDownloadInfo({
        total_bytes: 2 * GIB,
        downloaded_bytes: 1 * GIB,
        progress: 0.5,
        current_file: "model.safetensors",
      }),
    ]);
    renderModels();
    await waitForModels();

    expect(screen.getByRole("heading", { level: 2, name: "Downloading" })).toBeTruthy();
    expect(screen.getByText("1.00 GB / 2.00 GB")).toBeTruthy();
    expect(screen.getByText("model.safetensors")).toBeTruthy();
    expect(screen.getAllByText("Downloading: 50%")).toHaveLength(2);

    fireEvent.click(screen.getAllByRole("button", { name: "Cancel download" })[0]);

    await waitFor(() => expect(apiSpy.cancelDownload).toHaveBeenCalledWith("download-1"));
    expect(await screen.findByText("Download cancelled.")).toBeTruthy();
    await waitFor(() => expect(apiSpy.downloads.mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it("announces a download that finished while the page was open", async () => {
    apiSpy.downloads
      .mockResolvedValueOnce([makeDownloadInfo({ status: "running" })])
      .mockResolvedValueOnce([makeDownloadInfo({ status: "completed", progress: 1 })]);
    renderModels();
    await waitForModels();

    fireEvent.click(screen.getByRole("button", { name: "Refresh models" }));

    expect(await screen.findByText("Model download complete.")).toBeTruthy();
    await waitFor(() => expect(apiSpy.models).toHaveBeenCalledTimes(3));
    expect(apiSpy.downloads.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("shows an unknown progress label before the first bytes arrive", async () => {
    apiSpy.models.mockResolvedValue([makeModel(), makeNeuralModel()]);
    apiSpy.downloads.mockResolvedValue([
      makeDownloadInfo({ progress: 0, downloaded_bytes: 0, total_bytes: 0 }),
    ]);
    renderModels();
    await waitForModels();

    expect(screen.getAllByText("Downloading…").length).toBeGreaterThan(0);
  });

  it("removes an installed model after confirmation", async () => {
    apiSpy.models.mockResolvedValue([makeModel(), makeNeuralModel()]);
    renderModels();
    await waitForModels();

    fireEvent.click(screen.getByRole("button", { name: "Remove model" }));

    const dialog = screen.getByRole("dialog", { name: "Remove MusicGen Small?" });
    expect(
      within(dialog).getByText(
        "This deletes the downloaded model files from your Klyraudio data folder. You can download them again later.",
      ),
    ).toBeTruthy();

    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));

    await waitFor(() => expect(apiSpy.removeModel).toHaveBeenCalledWith("musicgen-small"));
    expect(await screen.findByText("Model removed.")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(apiSpy.models).toHaveBeenCalledTimes(2));
  });

  it("keeps the dialog open when removal fails", async () => {
    apiSpy.models.mockResolvedValue([makeModel(), makeNeuralModel()]);
    apiSpy.removeModel.mockRejectedValue(networkError());
    renderModels();
    await waitForModels();

    fireEvent.click(screen.getByRole("button", { name: "Remove model" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Remove" }));

    expect(await screen.findByText("Could not reach the local Klyraudio service.")).toBeTruthy();
    expect(screen.getByRole("dialog", { name: "Remove MusicGen Small?" })).toBeTruthy();
  });

  it("opens the model folder and reports failures", async () => {
    renderModels();
    await waitForModels();

    fireEvent.click(screen.getByRole("button", { name: "Open model folder" }));
    await waitFor(() => expect(apiSpy.openFolder).toHaveBeenCalledWith("models"));

    apiSpy.openFolder.mockRejectedValue(
      new ApiError({ code: "open_folder_failed", message: "Failed", status: 500 }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Open model folder" }));

    expect(await screen.findByText("The folder could not be opened.")).toBeTruthy();
  });

  it("refreshes models and downloads from the header", async () => {
    renderModels();
    await waitForModels();

    fireEvent.click(screen.getByRole("button", { name: "Refresh models" }));

    await waitFor(() => expect(apiSpy.models).toHaveBeenCalledTimes(2));
    expect(apiSpy.downloads).toHaveBeenCalledTimes(2);
  });

  it("shows a load error while keeping the page usable", async () => {
    apiSpy.models.mockRejectedValue(networkError());
    renderModels();
    await waitForModels();

    expect(await screen.findByText("Could not reach the local Klyraudio service.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Refresh models" })).toBeTruthy();
  });

  it("shows a loading row until the model list arrives", async () => {
    apiSpy.models.mockReturnValue(new Promise(() => {}));
    renderModels();

    expect(await screen.findByText("Loading…")).toBeTruthy();
  });
});
