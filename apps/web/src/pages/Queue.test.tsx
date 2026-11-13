import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import { ApiError } from "../api/client";
import { LocationProbe, renderPage } from "../test/pages";
import { type ApiSpies, mockApi } from "../test/api";
import { makeJob, makeModel, makeNeuralModel } from "../test/fixtures";
import { QueuePage } from "./Queue";

function renderQueuePage() {
  return renderPage(
    <Routes>
      <Route path="/" element={<QueuePage />} />
      <Route path="/generate/music" element={<LocationProbe />} />
      <Route path="/editor/:assetId" element={<LocationProbe />} />
      <Route path="/studio/:projectId" element={<LocationProbe />} />
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

describe("QueuePage", () => {
  let apiSpy: ApiSpies;

  beforeEach(() => {
    apiSpy = mockApi();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows the loading state before jobs arrive", () => {
    apiSpy.jobs.mockReturnValue(new Promise(() => {}));
    renderQueuePage();
    expect(screen.getByText("Loading…")).toBeTruthy();
  });

  it("shows empty states when there are no jobs", async () => {
    renderQueuePage();
    expect(await screen.findByText("No active jobs.")).toBeTruthy();
    expect(screen.getByText("The queue is empty")).toBeTruthy();
    expect(screen.getByText("Start a generation and it will appear here.")).toBeTruthy();
    expect(screen.getByText("0 active")).toBeTruthy();
  });

  it("renders running jobs with progress and resolved model names", async () => {
    apiSpy.jobs.mockResolvedValue([
      makeJob({
        id: "job-running",
        status: "running",
        progress: 0.4,
        output_asset_ids: [],
        model_id: "musicgen-small",
      }),
    ]);
    apiSpy.models.mockResolvedValue([makeModel(), makeNeuralModel()]);
    renderQueuePage();

    expect(await screen.findByText("Soft confirmation chime")).toBeTruthy();
    expect(screen.getByText("Running")).toBeTruthy();
    expect(screen.getByText("MusicGen Small")).toBeTruthy();
    expect(screen.getByText("Requested length")).toBeTruthy();
    expect(screen.getByText("0:03")).toBeTruthy();
    expect(screen.getByText("Variations")).toBeTruthy();
    const progress = screen.getByRole("progressbar");
    expect(progress.getAttribute("aria-valuenow")).toBe("40");
    expect(screen.getByText("1 active")).toBeTruthy();
  });

  it("renders queued jobs at zero and running jobs without progress as indeterminate", async () => {
    apiSpy.jobs.mockResolvedValue([
      makeJob({ id: "job-queued", status: "queued", progress: null, output_asset_ids: [] }),
      makeJob({
        id: "job-running",
        status: "running",
        progress: null,
        progress_label: "Step 2/10",
        output_asset_ids: [],
        prompt: "Second chime",
      }),
    ]);
    renderQueuePage();

    expect(await screen.findByText("Queued")).toBeTruthy();
    expect(screen.getByText("Step 2/10")).toBeTruthy();
    const bars = screen.getAllByRole("progressbar");
    expect(bars).toHaveLength(2);
    // Queued maps to a determinate zero; running without reported progress is indeterminate.
    expect(bars[0].getAttribute("aria-valuenow")).toBe("0");
    expect(bars[1].className).toContain("is-indeterminate");
  });

  it("renders failed jobs with their error details", async () => {
    apiSpy.jobs.mockResolvedValue([
      makeJob({
        id: "job-failed",
        status: "failed",
        output_asset_ids: [],
        error: {
          code: "generation_failed",
          message: "The worker crashed.",
          remediation: "Restart the local service.",
        },
      }),
    ]);
    renderQueuePage();

    expect(await screen.findByText("Failed")).toBeTruthy();
    expect(screen.getByText("What went wrong")).toBeTruthy();
    expect(screen.getByText("The worker crashed.")).toBeTruthy();
    expect(screen.getByText("Code: generation_failed")).toBeTruthy();
    expect(screen.getByText("What to try")).toBeTruthy();
    expect(screen.getByText("Restart the local service.")).toBeTruthy();
    // Failed jobs belong to the history panel and offer a retry.
    expect(screen.getByRole("button", { name: "Retry job" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Cancel job" })).toBeNull();
  });

  it("cancels a running job and reloads the list", async () => {
    apiSpy.jobs.mockResolvedValue([
      makeJob({ id: "job-running", status: "running", output_asset_ids: [] }),
    ]);
    renderQueuePage();
    await screen.findByText("Running");

    const callsBefore = apiSpy.jobs.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Cancel job" }));

    expect(apiSpy.cancelJob).toHaveBeenCalledWith("job-running");
    expect(await screen.findByText("Job cancelled.")).toBeTruthy();
    expect(apiSpy.jobs.mock.calls.length).toBe(callsBefore + 1);
  });

  it("reports a cancellation failure as a toast", async () => {
    apiSpy.jobs.mockResolvedValue([
      makeJob({ id: "job-running", status: "running", output_asset_ids: [] }),
    ]);
    apiSpy.cancelJob.mockRejectedValueOnce(
      new ApiError({
        code: "resource_busy",
        message: "Busy",
        status: 409,
      }),
    );
    renderQueuePage();
    await screen.findByText("Running");

    fireEvent.click(screen.getByRole("button", { name: "Cancel job" }));

    expect(
      await screen.findByText("Another operation is already using this resource."),
    ).toBeTruthy();
    expect(screen.queryByText("Job cancelled.")).toBeNull();
  });

  it("retries a failed job", async () => {
    apiSpy.jobs.mockResolvedValue([
      makeJob({ id: "job-failed", status: "failed", output_asset_ids: [] }),
    ]);
    renderQueuePage();
    await screen.findByText("Failed");

    fireEvent.click(screen.getByRole("button", { name: "Retry job" }));

    expect(apiSpy.retryJob).toHaveBeenCalledWith("job-failed");
    expect(await screen.findByText("Retry queued.")).toBeTruthy();
  });

  it("deletes a job after confirmation", async () => {
    apiSpy.jobs.mockResolvedValue([
      makeJob({ id: "job-failed", status: "failed", output_asset_ids: [] }),
    ]);
    renderQueuePage();
    await screen.findByText("Failed");

    fireEvent.click(screen.getByRole("button", { name: "Delete job" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Delete this job?")).toBeTruthy();
    // The job record is removed, but finished audio stays in the library.
    expect(
      within(dialog).getByText(
        "The job record is removed. Generated audio that already exists stays in the library.",
      ),
    ).toBeTruthy();

    const callsBefore = apiSpy.jobs.mock.calls.length;
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete job" }));

    expect(apiSpy.deleteJob).toHaveBeenCalledWith("job-failed");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(apiSpy.jobs.mock.calls.length).toBe(callsBefore + 1);
  });

  it("keeps a job when the delete dialog is cancelled", async () => {
    apiSpy.jobs.mockResolvedValue([
      makeJob({ id: "job-failed", status: "failed", output_asset_ids: [] }),
    ]);
    renderQueuePage();
    await screen.findByText("Failed");

    fireEvent.click(screen.getByRole("button", { name: "Delete job" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(apiSpy.deleteJob).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("Failed")).toBeTruthy();
  });

  it("collapses and expands the finished list", async () => {
    apiSpy.jobs.mockResolvedValue([
      makeJob({ id: "job-failed", status: "failed", output_asset_ids: [] }),
    ]);
    renderQueuePage();
    await screen.findByText("Failed");

    fireEvent.click(screen.getByRole("button", { name: "Hide finished jobs" }));
    expect(screen.getByRole("button", { name: "Show finished jobs" })).toBeTruthy();
    expect(screen.queryByText("Failed")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Show finished jobs" }));
    expect(screen.getByText("Failed")).toBeTruthy();
  });

  it("opens a finished output in the editor", async () => {
    apiSpy.jobs.mockResolvedValue([makeJob({ id: "job-done" })]);
    renderQueuePage();
    await screen.findByText("Completed");

    fireEvent.click(screen.getByRole("button", { name: "Open in editor" }));

    expect(JSON.parse(screen.getByTestId("location").textContent ?? "{}")).toEqual({
      pathname: "/editor/asset-1",
      params: { assetId: "asset-1" },
    });
  });

  it("sends a finished output to a new studio project", async () => {
    apiSpy.jobs.mockResolvedValue([makeJob({ id: "job-done" })]);
    renderQueuePage();
    await screen.findByText("Completed");

    fireEvent.click(screen.getByRole("button", { name: "Send to Studio" }));

    expect(apiSpy.asset).toHaveBeenCalledWith("asset-1");
    await waitFor(() => expect(apiSpy.createProject).toHaveBeenCalled());
    expect(apiSpy.createProject).toHaveBeenCalledWith({
      name: "Test chime.wav",
      sample_rate: 44100,
    });
    const [projectId, update] = apiSpy.updateProject.mock.calls[0] ?? [];
    expect(projectId).toBe("project-1");
    expect(update.document.tracks[0].clips[0].asset_id).toBe("asset-1");
    expect(await screen.findByText("Added to a new Studio project.")).toBeTruthy();
    expect(JSON.parse(screen.getByTestId("location").textContent ?? "{}")).toEqual({
      pathname: "/studio/project-1",
      params: { projectId: "project-1" },
    });
  });

  it("navigates to the generation page from the header", async () => {
    apiSpy.jobs.mockResolvedValue([
      makeJob({ id: "job-running", status: "running", output_asset_ids: [] }),
    ]);
    renderQueuePage();
    await screen.findByText("Running");

    fireEvent.click(screen.getByRole("button", { name: "Create music" }));

    expect(JSON.parse(screen.getByTestId("location").textContent ?? "{}")).toEqual({
      pathname: "/generate/music",
      params: {},
    });
  });

  it("surfaces job list errors and keeps the page interactive", async () => {
    apiSpy.jobs.mockRejectedValue(networkError());
    renderQueuePage();

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Could not reach the local Klyraudio service.",
    );
    // The list stays in its loading state, but the refresh action still works.
    const callsBefore = apiSpy.jobs.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(apiSpy.jobs.mock.calls.length).toBeGreaterThan(callsBefore));
  });
});
