import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import { ApiError } from "../api/client";
import { LocationProbe, renderPage } from "../test/pages";
import { type ApiSpies, mockApi } from "../test/api";
import { DATA_DIR, makeJob, makeModel, makeNeuralModel, makeSettings } from "../test/fixtures";
import { HomePage } from "./Home";

function renderHomePage() {
  return renderPage(
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/generate/:task" element={<LocationProbe />} />
      <Route path="/studio" element={<LocationProbe />} />
      <Route path="/editor/:assetId" element={<LocationProbe />} />
      <Route path="/studio/:projectId" element={<LocationProbe />} />
      <Route path="/onboarding" element={<LocationProbe />} />
    </Routes>,
  );
}

function networkError(): ApiError {
  return new ApiError({
    code: "network_error",
    message: "Could not reach the local Klyraudio service.",
    status: 0,
  });
}

describe("HomePage", () => {
  let apiSpy: ApiSpies;

  beforeEach(() => {
    apiSpy = mockApi();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the overview with live stats from the service", async () => {
    apiSpy.jobs.mockResolvedValue([
      makeJob({ id: "job-running", status: "running", output_asset_ids: [] }),
      makeJob({ id: "job-done", prompt: "Recent chime" }),
    ]);
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
    apiSpy.assets.mockResolvedValue({ items: [], total: 3 });
    renderHomePage();

    expect(
      await screen.findByRole("heading", { level: 2, name: "Create sound from imagination." }),
    ).toBeTruthy();
    // Stat row reflects the service data.
    const libraryStat = screen.getByRole("button", { name: /Library/ });
    expect(within(libraryStat).getByText("3")).toBeTruthy();
    const activeStat = screen.getByRole("button", { name: /Active/ });
    expect(within(activeStat).getByText("1")).toBeTruthy();
    const modelsStat = screen.getByRole("button", { name: /Neural models/ });
    expect(within(modelsStat).getByText("1")).toBeTruthy();
    expect(screen.getByText("Online")).toBeTruthy();

    // Recent generations list the finished job with its actions.
    expect(screen.getByText("Recent chime")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open in editor" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Send to Studio" })).toBeTruthy();
    expect(screen.getByText("View all")).toBeTruthy();

    // The engine panel summarizes the system report.
    expect(screen.getAllByText("Test GPU · 8.0 GB")).toHaveLength(2);
    expect(screen.getByText("121 GB free")).toBeTruthy();
    expect(screen.getByText(DATA_DIR)).toBeTruthy();

    // The model summary lists models with their availability.
    expect(screen.getByText("MusicGen Small")).toBeTruthy();
    expect(screen.getByText("Stable Audio Open")).toBeTruthy();
    expect(screen.getByText("Not installed")).toBeTruthy();
  });

  it("shows the empty overview before anything is generated", async () => {
    renderHomePage();

    expect(
      await screen.findByText("Nothing generated yet. Your first sound starts with a prompt."),
    ).toBeTruthy();
    const libraryStat = screen.getByRole("button", { name: /Library/ });
    expect(within(libraryStat).getByText("0")).toBeTruthy();
    const activeStat = screen.getByRole("button", { name: /Active/ });
    expect(within(activeStat).getByText("0")).toBeTruthy();
    const modelsStat = screen.getByRole("button", { name: /Neural models/ });
    expect(within(modelsStat).getByText("0")).toBeTruthy();
    expect(
      screen.getByText(
        "The built-in Sketch DSP engine is ready now. Install a neural model when you want AI generation.",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "View all" })).toBeNull();
  });

  it("shows the first-run setup banner until onboarding is complete", async () => {
    apiSpy.getSettings.mockResolvedValueOnce(makeSettings({ onboarding_complete: false }));
    renderHomePage();

    expect(await screen.findByText("First-time setup")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Continue setup" }));
    expect(JSON.parse(screen.getByTestId("location").textContent ?? "{}")).toEqual({
      pathname: "/onboarding",
      params: {},
    });
  });

  it("hides the setup banner once onboarding is complete", async () => {
    renderHomePage();
    await screen.findByRole("heading", { level: 2, name: "Create sound from imagination." });
    expect(screen.queryByText("First-time setup")).toBeNull();
  });

  it("reports when service data cannot load", async () => {
    apiSpy.assets.mockRejectedValue(networkError());
    renderHomePage();

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Could not reach the local Klyraudio service.",
    );
  });

  it("shows the offline engine status when the settings service is down", async () => {
    apiSpy.getSettings.mockRejectedValue(networkError());
    renderHomePage();
    await screen.findByText("Local service offline");

    expect(screen.getByText("Offline")).toBeTruthy();
    // The engine panel repeats the status in its subtitle and summary.
    expect(
      screen.getAllByText("The local service is not reachable. Start it to begin creating."),
    ).toHaveLength(2);
    // Page data still loads; only the engine status degrades.
    expect(
      await screen.findByText("Nothing generated yet. Your first sound starts with a prompt."),
    ).toBeTruthy();
  });

  it("navigates to the generation pages from the hero and quick cards", async () => {
    apiSpy.jobs.mockResolvedValue([makeJob()]);
    renderHomePage();
    await screen.findByText("Recent chime").catch(() => {});
    await screen.findByRole("heading", { level: 2, name: "Create sound from imagination." });

    const musicCard = screen.getByRole("link", { name: /Create music/ });
    expect(musicCard.getAttribute("href")).toBe("/generate/music");
    expect(screen.getByRole("link", { name: /Create a sound effect/ }).getAttribute("href")).toBe(
      "/generate/sfx",
    );
    expect(screen.getByRole("link", { name: /Create an atmosphere/ }).getAttribute("href")).toBe(
      "/generate/ambient",
    );

    // Both the header and the hero offer music generation.
    fireEvent.click(screen.getAllByRole("button", { name: "Create music" })[0]);
    expect(JSON.parse(screen.getByTestId("location").textContent ?? "{}")).toEqual({
      pathname: "/generate/music",
      params: { task: "music" },
    });
  });

  it("opens a recent output in the editor", async () => {
    apiSpy.jobs.mockResolvedValue([makeJob({ id: "job-done", prompt: "Recent chime" })]);
    renderHomePage();
    await screen.findByText("Recent chime");

    fireEvent.click(screen.getByRole("button", { name: "Open in editor" }));

    expect(JSON.parse(screen.getByTestId("location").textContent ?? "{}")).toEqual({
      pathname: "/editor/asset-1",
      params: { assetId: "asset-1" },
    });
  });

  it("sends a recent output to a new studio project", async () => {
    apiSpy.jobs.mockResolvedValue([makeJob({ id: "job-done", prompt: "Recent chime" })]);
    renderHomePage();
    await screen.findByText("Recent chime");

    fireEvent.click(screen.getByRole("button", { name: "Send to Studio" }));

    expect(apiSpy.asset).toHaveBeenCalledWith("asset-1");
    await waitFor(() => expect(apiSpy.createProject).toHaveBeenCalled());
    expect(apiSpy.createProject).toHaveBeenCalledWith({
      name: "Test chime.wav",
      sample_rate: 44100,
    });
    expect(await screen.findByText("Added to a new Studio project.")).toBeTruthy();
    expect(JSON.parse(screen.getByTestId("location").textContent ?? "{}")).toEqual({
      pathname: "/studio/project-1",
      params: { projectId: "project-1" },
    });
  });
});
