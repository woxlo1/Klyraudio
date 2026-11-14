import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import { ApiError } from "../api/client";
import { LocationProbe, renderPage } from "../test/pages";
import { type ApiSpies, mockApi } from "../test/api";
import {
  DATA_DIR,
  makeJob,
  makeModel,
  makeNeuralModel,
  makeSettings,
  makeSystemInfo,
} from "../test/fixtures";
import { OnboardingPage } from "./Onboarding";

function renderOnboardingPage() {
  return renderPage(
    <Routes>
      <Route path="/onboarding" element={<OnboardingPage />} />
      <Route path="/" element={<LocationProbe />} />
      <Route path="/models" element={<LocationProbe />} />
    </Routes>,
    { route: "/onboarding" },
  );
}

/** Flush the settings provider and the page's initial model/storage requests. */
async function settleData() {
  await act(async () => {});
}

function currentStepHeading() {
  return screen.getByRole("heading", { level: 2 });
}

function clickNext(times: number) {
  for (let index = 0; index < times; index += 1) {
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
  }
}

function networkError(): ApiError {
  return new ApiError({
    code: "network_error",
    message: "Could not reach the local Klyraudio service.",
    status: 0,
  });
}

describe("OnboardingPage", () => {
  let apiSpy: ApiSpies;

  beforeEach(() => {
    apiSpy = mockApi();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("starts at the welcome step and flags an already completed setup", async () => {
    renderOnboardingPage();
    await settleData();

    expect(currentStepHeading().textContent).toBe("Welcome to your local audio studio");
    expect(screen.getByText("Step 1 of 7")).toBeTruthy();
    expect(screen.getByText("Setup complete")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
    expect(screen.getByRole("button", { name: "Skip for now" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Next" })).toBeTruthy();
    expect(
      screen.getByText(
        "Klyraudio generates and edits audio on your computer. No account is required, and nothing is uploaded.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "Everything runs on this device, so your audio stays private and works offline.",
      ),
    ).toBeTruthy();
    expect(apiSpy.models).toHaveBeenCalled();
  });

  it("walks forward and back through every step", async () => {
    renderOnboardingPage();
    await settleData();

    const titles = [
      "Check your system",
      "Choose your workspace",
      "Choose how to generate",
      "Understand model licenses",
      "Try a short generation",
      "You are ready",
    ];
    for (const [index, title] of titles.entries()) {
      clickNext(1);
      expect(currentStepHeading().textContent).toBe(title);
      expect(screen.getByText(`Step ${index + 2} of 7`)).toBeTruthy();
    }
    expect(screen.getByRole("button", { name: "Start creating" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(currentStepHeading().textContent).toBe("Try a short generation");
  });

  it("shows the system checks from the service report", async () => {
    renderOnboardingPage();
    await settleData();
    clickNext(1);

    expect(screen.getAllByText("Ready")).toHaveLength(5);
    expect(screen.getByText("Local service")).toBeTruthy();
    expect(screen.getByText(/6\.0/)).toBeTruthy();
    expect(screen.getByText(/Test CPU \(8\)/)).toBeTruthy();
    expect(screen.getByText(/16 GB/)).toBeTruthy();
    expect(screen.getByText(/120\.5 GB/)).toBeTruthy();
  });

  it("shows system warnings on the check step", async () => {
    apiSpy.systemInfo.mockResolvedValueOnce(
      makeSystemInfo({
        ffmpeg_available: false,
        warnings: ["Only 2 GB of free disk space remains."],
      }),
    );
    renderOnboardingPage();
    await settleData();
    clickNext(1);

    expect(screen.getByText("Only 2 GB of free disk space remains.")).toBeTruthy();
    expect(screen.getByText("Needs attention")).toBeTruthy();
  });

  it("opens the data folder from the storage step", async () => {
    renderOnboardingPage();
    await settleData();
    clickNext(2);

    expect(screen.getByText(DATA_DIR)).toBeTruthy();
    expect(screen.getByText("1.00 MB")).toBeTruthy();
    expect(screen.getByText("120.5 GB")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Open data folder" }));
    expect(apiSpy.openFolder).toHaveBeenCalledWith("data");
    await waitFor(() => expect(apiSpy.openFolder).toHaveBeenCalledTimes(1));
  });

  it("reports a folder that cannot be opened", async () => {
    apiSpy.openFolder.mockRejectedValue(
      new ApiError({ code: "open_folder_failed", message: "Failed", status: 500 }),
    );
    renderOnboardingPage();
    await settleData();
    clickNext(2);

    fireEvent.click(screen.getByRole("button", { name: "Open data folder" }));

    expect(await screen.findByText("The folder could not be opened.")).toBeTruthy();
  });

  it("summarizes the built-in engine and neural models", async () => {
    apiSpy.models.mockResolvedValue([
      makeModel(),
      makeNeuralModel(),
      makeNeuralModel({
        id: "stable-audio",
        name: "Stable Audio Open",
        installed: false,
        availability: "not-installed",
      }),
    ]);
    renderOnboardingPage();
    await settleData();
    clickNext(3);

    expect(screen.getByText("Klyraudio Sketch")).toBeTruthy();
    expect(screen.getByText("1 / 2")).toBeTruthy();
    expect(screen.getByText("Neural model")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Use the built-in engine" }));
    expect(currentStepHeading().textContent).toBe("Understand model licenses");
  });

  it("opens the model manager from the model step", async () => {
    renderOnboardingPage();
    await settleData();
    clickNext(3);

    fireEvent.click(screen.getByRole("button", { name: "Open Model Manager" }));

    expect(JSON.parse(screen.getByTestId("location").textContent ?? "{}")).toEqual({
      pathname: "/models",
      params: {},
    });
  });

  it("lists every neural model license on the license step", async () => {
    apiSpy.models.mockResolvedValue([
      makeModel(),
      makeNeuralModel(),
      makeNeuralModel({
        id: "stable-audio",
        name: "Stable Audio Open",
        license_name: "Stability AI Community License",
        license_url: "https://stability.ai/license",
        commercial_use: "varies",
        gated: true,
      }),
    ]);
    renderOnboardingPage();
    await settleData();
    clickNext(4);

    expect(screen.getByText("CC BY-NC 4.0")).toBeTruthy();
    expect(screen.getByText("Stability AI Community License")).toBeTruthy();
    expect(screen.getByText("Not permitted by the model license")).toBeTruthy();
    expect(screen.getByText("Varies — conditions apply")).toBeTruthy();
    expect(screen.getByText("A Hugging Face account is required")).toBeTruthy();
    const links = screen.getAllByRole("link", { name: "Read the license" });
    expect(links).toHaveLength(2);
    expect(links[1].getAttribute("href")).toBe("https://stability.ai/license");
  });

  it("generates a test sound and reports success", async () => {
    renderOnboardingPage();
    await settleData();
    clickNext(5);

    fireEvent.click(screen.getByRole("button", { name: "Generate a test sound" }));

    expect(apiSpy.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        model_id: "klyraudio-sketch",
        task: "sfx",
        duration: 3,
        variations: 1,
        prompt: "Short soft confirmation chime, gentle, clean",
      }),
    );
    expect(await screen.findByText("Test audio generated and added to your library.")).toBeTruthy();
    expect(screen.getByText(/Test chime\.wav/)).toBeTruthy();
    expect(apiSpy.asset).toHaveBeenCalledWith("asset-1");
  });

  it("polls a running test job until it completes", async () => {
    apiSpy.generate.mockResolvedValueOnce({
      jobs: [makeJob({ id: "job-test", status: "running", progress: 0.5, output_asset_ids: [] })],
      warnings: [],
    });
    apiSpy.job.mockResolvedValueOnce(makeJob({ id: "job-test", status: "completed" }));
    renderOnboardingPage();
    await settleData();
    clickNext(5);

    vi.useFakeTimers();
    try {
      fireEvent.click(screen.getByRole("button", { name: "Generate a test sound" }));
      expect(screen.getAllByText("Generating a test sound…").length).toBeGreaterThan(0);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(800);
      });
    } finally {
      vi.useRealTimers();
    }

    expect(await screen.findByText("Test audio generated and added to your library.")).toBeTruthy();
    expect(apiSpy.job).toHaveBeenCalledWith("job-test");
    expect(apiSpy.asset).toHaveBeenCalledWith("asset-1");
  });

  it("reports a failed test generation", async () => {
    apiSpy.generate.mockRejectedValue(
      new ApiError({ code: "generation_failed", message: "Failed", status: 500 }),
    );
    renderOnboardingPage();
    await settleData();
    clickNext(5);

    fireEvent.click(screen.getByRole("button", { name: "Generate a test sound" }));

    expect(await screen.findByText("Audio generation failed.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Generate a test sound" })).toBeTruthy();
  });

  it("skipping setup marks it complete and returns home", async () => {
    renderOnboardingPage();
    await settleData();

    fireEvent.click(screen.getByRole("button", { name: "Skip for now" }));

    expect(apiSpy.updateSettings).toHaveBeenCalledWith({ onboarding_complete: true });
    expect(
      await screen.findByText("The setup guide is skipped. You can reopen it from Settings."),
    ).toBeTruthy();
    await screen.findByTestId("location");
    expect(JSON.parse(screen.getByTestId("location").textContent ?? "{}")).toEqual({
      pathname: "/",
      params: {},
    });
  });

  it("finishing setup from the last step returns home", async () => {
    renderOnboardingPage();
    await settleData();
    clickNext(6);

    expect(currentStepHeading().textContent).toBe("You are ready");
    fireEvent.click(screen.getByRole("button", { name: "Start creating" }));

    expect(apiSpy.updateSettings).toHaveBeenCalledWith({ onboarding_complete: true });
    expect(await screen.findByText("Setup marked as complete.")).toBeTruthy();
    await screen.findByTestId("location");
    expect(JSON.parse(screen.getByTestId("location").textContent ?? "{}")).toEqual({
      pathname: "/",
      params: {},
    });
  });

  it("warns when the model list cannot load", async () => {
    apiSpy.models.mockRejectedValue(networkError());
    renderOnboardingPage();
    await settleData();
    clickNext(3);

    expect(screen.getByText("Could not reach the local Klyraudio service.")).toBeTruthy();
    // The built-in fallback name keeps the step usable.
    expect(screen.getByText("Klyraudio Sketch")).toBeTruthy();
  });

  it("shows the setup badge only when onboarding is already complete", async () => {
    apiSpy.getSettings.mockResolvedValueOnce(makeSettings({ onboarding_complete: false }));
    renderOnboardingPage();
    await settleData();
    expect(screen.queryByText("Setup complete")).toBeNull();
  });
});
