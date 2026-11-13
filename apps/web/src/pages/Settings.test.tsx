import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { ApiError } from "../api/client";
import { pageRoutes, renderPage } from "../test/pages";
import { type ApiSpies, mockApi } from "../test/api";
import { DATA_DIR, EXPORT_DIR, makeSettings, makeStorage, makeSystemInfo } from "../test/fixtures";
import { SettingsPage } from "./Settings";

function networkError(): ApiError {
  return new ApiError({
    code: "network_error",
    message: "Could not reach the local Klyraudio service.",
    status: 0,
  });
}

function selectValue(name: string): string {
  return (screen.getByRole("combobox", { name }) as HTMLSelectElement).value;
}

function sliderValue(): string {
  return (screen.getByRole("slider") as HTMLInputElement).value;
}

describe("SettingsPage", () => {
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

  async function renderSettings() {
    renderPage(
      pageRoutes("/settings", <SettingsPage />, [{ path: "/" }, { path: "/onboarding" }]),
      { route: "/settings" },
    );
    // The page renders after the settings provider resolves both settings and system info.
    await screen.findByText(DATA_DIR);
    await waitFor(() => expect(apiSpy.exportCapabilities).toHaveBeenCalled());
    await waitFor(() => expect(apiSpy.exportFolder).toHaveBeenCalled());
  }

  async function persistOnChange(
    element: HTMLElement,
    value: string,
    patch: Record<string, unknown>,
  ): Promise<void> {
    fireEvent.change(element, { target: { value } });
    await waitFor(() => expect(apiSpy.updateSettings).toHaveBeenCalledWith(patch));
  }

  it("renders the preferences and diagnostics reported by the service", async () => {
    apiSpy.exportFolder.mockResolvedValue({ path: EXPORT_DIR });
    await renderSettings();

    expect(screen.getByRole("heading", { level: 1, name: "Settings" })).toBeTruthy();
    expect(
      screen.getByText(
        "Preferences, local storage, and diagnostics for this Klyraudio installation.",
      ),
    ).toBeTruthy();

    // Preferences reflect the stored settings.
    expect(selectValue("Interface language")).toBe("en");
    expect(selectValue("Theme")).toBe("dark");
    expect(selectValue("Default export format")).toBe("wav");
    expect(selectValue("Default sample rate")).toBe("44100");
    expect(selectValue("Inference backend")).toBe("auto");
    expect(sliderValue()).toBe("1");

    // Data folders and managed storage.
    expect(screen.getByText(DATA_DIR)).toBeTruthy();
    expect(screen.getByText(EXPORT_DIR)).toBeTruthy();
    expect(screen.getAllByText("1.00 MB")).toHaveLength(2);
    expect(screen.getAllByText("120.5 GB")).toHaveLength(2);

    // Diagnostics.
    expect(screen.getByText("0.1.0")).toBeTruthy();
    expect(screen.getByText("TestOS 1.0")).toBeTruthy();
    expect(screen.getByText("x86_64")).toBeTruthy();
    expect(screen.getByText("Test CPU (8)")).toBeTruthy();
    expect(screen.getByText("8.0 GB / 16 GB")).toBeTruthy();
    expect(screen.getByText("Test GPU · cuda · 8.0 GB")).toBeTruthy();
    expect(screen.getByText("cpu, cuda")).toBeTruthy();
    expect(screen.getByText("6.0")).toBeTruthy();
    expect(screen.getByText("3.13.0")).toBeTruthy();
    expect(screen.getByText("v1")).toBeTruthy();
    expect(screen.getByText("Online")).toBeTruthy();
    expect(screen.getByText("cuda")).toBeTruthy();
  });

  it("only offers export formats the service can encode", async () => {
    await renderSettings();

    const formats = screen.getByRole("combobox", { name: "Default export format" });
    expect(within(formats).getByRole("option", { name: "WAV" })).toBeTruthy();
    expect(within(formats).getByRole("option", { name: "FLAC" })).toBeTruthy();
    expect(within(formats).getByRole("option", { name: "MP3" })).toBeTruthy();
    expect(within(formats).queryByRole("option", { name: "OGG" })).toBeNull();
  });

  it("falls back to the built-in format list when capabilities fail", async () => {
    apiSpy.exportCapabilities.mockRejectedValue(networkError());
    await renderSettings();

    const formats = screen.getByRole("combobox", { name: "Default export format" });
    expect(within(formats).getByRole("option", { name: "AIFF" })).toBeTruthy();
    expect(within(formats).getByRole("option", { name: "OPUS" })).toBeTruthy();
    expect(within(formats).getByRole("option", { name: "OGG" })).toBeTruthy();
  });

  it("persists the theme, applies it, and confirms the save", async () => {
    apiSpy.updateSettings.mockImplementation(async (patch) => makeSettings(patch));
    await renderSettings();

    await persistOnChange(screen.getByRole("combobox", { name: "Theme" }), "light", {
      theme: "light",
    });

    expect(apiSpy.updateSettings).toHaveBeenCalledWith({ theme: "light" });
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("light"));
    expect(await screen.findByText("Settings saved.")).toBeTruthy();
  });

  it("persists the reduced-motion preference", async () => {
    apiSpy.updateSettings.mockImplementation(async (patch) => makeSettings(patch));
    await renderSettings();

    fireEvent.click(screen.getByRole("switch", { name: "Reduce motion" }));

    await waitFor(() =>
      expect(apiSpy.updateSettings).toHaveBeenCalledWith({ reduce_motion: true }),
    );
    await waitFor(() => expect(document.documentElement.dataset.reduceMotion).toBe("true"));
    expect(await screen.findByText("Settings saved.")).toBeTruthy();
  });

  it("persists the export format and sample rate", async () => {
    await renderSettings();

    await persistOnChange(screen.getByRole("combobox", { name: "Default export format" }), "flac", {
      default_export_format: "flac",
    });

    await persistOnChange(screen.getByRole("combobox", { name: "Default sample rate" }), "48000", {
      default_sample_rate: 48000,
    });
  });

  it("persists the inference backend and concurrency", async () => {
    apiSpy.updateSettings.mockImplementation(async (patch) => makeSettings(patch));
    await renderSettings();

    await persistOnChange(screen.getByRole("combobox", { name: "Inference backend" }), "cpu", {
      gpu_preference: "cpu",
    });

    fireEvent.change(screen.getByRole("slider"), { target: { value: "3" } });
    await waitFor(() =>
      expect(apiSpy.updateSettings).toHaveBeenLastCalledWith({ max_concurrent_jobs: 3 }),
    );
    expect(sliderValue()).toBe("3");
  });

  it("reports a failed save without changing the selection", async () => {
    apiSpy.updateSettings.mockRejectedValue(networkError());
    await renderSettings();

    fireEvent.change(screen.getByRole("combobox", { name: "Theme" }), {
      target: { value: "light" },
    });

    expect(await screen.findByText("Could not reach the local Klyraudio service.")).toBeTruthy();
    expect(selectValue("Theme")).toBe("dark");
  });

  it("switches the interface language and stores it", async () => {
    await renderSettings();

    fireEvent.change(screen.getByRole("combobox", { name: "Interface language" }), {
      target: { value: "ja" },
    });

    await waitFor(() => expect(apiSpy.updateSettings).toHaveBeenCalledWith({ language: "ja" }));
    expect(document.documentElement.lang).toBe("ja");
    expect(screen.getByRole("heading", { level: 1, name: "設定" })).toBeTruthy();
  });

  it("opens the data, export, and model folders", async () => {
    await renderSettings();

    fireEvent.click(screen.getByRole("button", { name: "Open data folder" }));
    fireEvent.click(screen.getByRole("button", { name: "Open export folder" }));
    fireEvent.click(screen.getByRole("button", { name: "Open model folder" }));

    await waitFor(() => expect(apiSpy.openFolder).toHaveBeenCalledTimes(3));
    expect(apiSpy.openFolder.mock.calls).toEqual([["data"], ["exports"], ["models"]]);
  });

  it("reports a folder that cannot be opened", async () => {
    apiSpy.openFolder.mockRejectedValue(
      new ApiError({ code: "open_folder_failed", message: "Failed", status: 500 }),
    );
    await renderSettings();

    fireEvent.click(screen.getByRole("button", { name: "Open data folder" }));

    expect(await screen.findByText("The folder could not be opened.")).toBeTruthy();
  });

  it("copies the data and export paths to the clipboard", async () => {
    apiSpy.exportFolder.mockResolvedValue({ path: EXPORT_DIR });
    await renderSettings();

    const copyButtons = screen.getAllByRole("button", { name: "Copy path" });
    fireEvent.click(copyButtons[0]);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(DATA_DIR));

    fireEvent.click(copyButtons[1]);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(EXPORT_DIR));
    expect(await screen.findAllByText("Path copied.")).toHaveLength(2);
  });

  it("reports a clipboard failure", async () => {
    writeText.mockRejectedValue(new Error("Clipboard blocked"));
    await renderSettings();

    fireEvent.click(screen.getAllByRole("button", { name: "Copy path" })[0]);

    expect(await screen.findByText("Unexpected error: Clipboard blocked")).toBeTruthy();
  });

  it("refreshes the settings and service details", async () => {
    await renderSettings();

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    await waitFor(() => expect(apiSpy.getSettings).toHaveBeenCalledTimes(2));
    expect(apiSpy.systemInfo).toHaveBeenCalledTimes(2);
    expect(apiSpy.exportCapabilities).toHaveBeenCalledTimes(2);
    expect(apiSpy.storage).toHaveBeenCalledTimes(2);
    expect(apiSpy.health).toHaveBeenCalledTimes(2);
    expect(apiSpy.exportFolder).toHaveBeenCalledTimes(2);
  });

  it("explains how to start the service when it is offline", async () => {
    apiSpy.getSettings.mockRejectedValue(networkError());
    apiSpy.systemInfo.mockRejectedValue(networkError());

    renderPage(pageRoutes("/settings", <SettingsPage />), { route: "/settings" });

    expect(await screen.findByText("The local service is offline.")).toBeTruthy();
    expect(screen.getByText("Start the service, then refresh this page.")).toBeTruthy();
    expect(screen.getByText(/python -m uvicorn klyraudio_api\.app/)).toBeTruthy();
    expect(screen.getByText("Could not reach the local Klyraudio service.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(apiSpy.getSettings).toHaveBeenCalledTimes(2));
    expect(apiSpy.health).toHaveBeenCalled();
  });

  it("shows a loading state while the settings request is pending", async () => {
    apiSpy.getSettings.mockReturnValue(new Promise(() => {}));

    renderPage(pageRoutes("/settings", <SettingsPage />), { route: "/settings" });

    expect(await screen.findByText("Loading…")).toBeTruthy();
    expect(screen.queryByText(DATA_DIR)).toBeNull();
  });

  it("lists system warnings in the diagnostics panel", async () => {
    apiSpy.systemInfo.mockResolvedValue(
      makeSystemInfo({ warnings: ["FFmpeg was not found on PATH."] }),
    );
    await renderSettings();

    expect(screen.getByText("Hardware notes")).toBeTruthy();
    expect(screen.getByText("FFmpeg was not found on PATH.")).toBeTruthy();
  });

  it("navigates to the setup guide", async () => {
    await renderSettings();

    fireEvent.click(screen.getByRole("button", { name: "Open setup guide" }));

    expect(JSON.parse(screen.getByTestId("location").textContent ?? "{}")).toEqual({
      pathname: "/onboarding",
      params: {},
    });
  });

  it("shows dashes when the storage summary is empty", async () => {
    apiSpy.storage.mockResolvedValue(makeStorage({ managed_bytes: 0 }));
    await renderSettings();

    expect(screen.getAllByText("0 B")).toHaveLength(2);
  });
});
