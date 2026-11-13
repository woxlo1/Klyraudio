import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import { ApiError } from "../api/client";
import { LocationProbe, renderPage } from "../test/pages";
import { type ApiSpies, mockApi } from "../test/api";
import {
  makeAsset,
  makeJob,
  makeModel,
  makeNeuralModel,
  makeProjectInfo,
  makeSystemInfo,
} from "../test/fixtures";
import { GeneratePage } from "./Generate";

function networkError(): ApiError {
  return new ApiError({
    code: "network_error",
    message: "Could not reach the local Klyraudio service.",
    status: 0,
  });
}

function renderGenerate(task = "music") {
  return renderPage(
    <Routes>
      <Route path="/generate/:task" element={<GeneratePage />} />
      <Route path="/models" element={<LocationProbe />} />
      <Route path="/queue" element={<LocationProbe />} />
      <Route path="/editor/:assetId" element={<LocationProbe />} />
      <Route path="/studio/:projectId" element={<LocationProbe />} />
    </Routes>,
    { route: `/generate/${task}` },
  );
}

function currentLocation() {
  return JSON.parse(screen.getByTestId("location").textContent ?? "{}");
}

async function settleGenerate(taskTitle: string) {
  await screen.findByRole("heading", { level: 1, name: taskTitle });
  await screen.findByLabelText("Prompt");
  await waitFor(() => expect(screen.queryByText("Loading…")).toBeNull());
}

function promptBox(): HTMLTextAreaElement {
  return screen.getByLabelText("Prompt") as HTMLTextAreaElement;
}

function generateButton(): HTMLButtonElement {
  return screen.getByRole("button", { name: "Generate audio" }) as HTMLButtonElement;
}

function rangeValue(name: string): string {
  return (screen.getByLabelText(name) as HTMLInputElement).value;
}

describe("GeneratePage", () => {
  let apiSpy: ApiSpies;

  beforeEach(() => {
    apiSpy = mockApi();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the music form with its defaults", async () => {
    renderGenerate();
    await settleGenerate("Create music");

    expect(
      screen.getByText(
        "Describe instruments, mood, and energy. Controls that the selected model cannot honor stay hidden.",
      ),
    ).toBeTruthy();
    expect(
      screen.getAllByText(
        "Describe what you hear. Concrete details work better than a single word.",
      ).length,
    ).toBeGreaterThan(0);
    expect(promptBox().getAttribute("placeholder")).toBe(
      "Warm lo-fi piano with soft vinyl crackle, slow drums, rainy night, instrumental",
    );
    expect((screen.getByLabelText("Model") as HTMLSelectElement).value).toBe("klyraudio-sketch");
    expect(screen.getByRole("option", { name: "Klyraudio Sketch — DSP · Not AI" })).toBeTruthy();
    expect(rangeValue("Duration")).toBe("12");
    expect(screen.getByText("12 seconds")).toBeTruthy();
    expect((screen.getByLabelText("Variations") as HTMLSelectElement).value).toBe("1");
    expect(screen.getByText("No jobs yet.")).toBeTruthy();
    expect(
      screen.getByText(
        "Generation runs locally. You can leave this page; the job continues in the queue.",
      ),
    ).toBeTruthy();
    expect(generateButton().disabled).toBe(false);
    // The built-in engine is labelled so the user knows what made the sound.
    expect(screen.getByText("DSP · Not AI")).toBeTruthy();
    expect(
      screen.getByText(
        "Klyraudio Sketch is a built-in DSP synthesizer, not an AI model. It is clearly labeled so you always know what made the sound.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/No GPU is configured/)).toBeNull();
  });

  it("redirects an unknown task to music", async () => {
    renderPage(
      <Routes>
        <Route path="/generate/:task" element={<GeneratePage />} />
        <Route path="/generate/music" element={<LocationProbe />} />
      </Routes>,
      { route: "/generate/unknown" },
    );

    await waitFor(() =>
      expect(currentLocation()).toEqual({ pathname: "/generate/music", params: {} }),
    );
  });

  it("uses task-specific durations and copy", async () => {
    const { unmount } = renderGenerate("sfx");
    await settleGenerate("Create a sound effect");
    expect(rangeValue("Duration")).toBe("4");
    expect(screen.getByText("4 seconds")).toBeTruthy();
    expect((screen.getByLabelText("Model") as HTMLSelectElement).value).toBe("klyraudio-sketch");
    unmount();

    renderGenerate("ambient");
    await settleGenerate("Create an atmosphere");
    expect(rangeValue("Duration")).toBe("20");
    expect(screen.getByText("20 seconds")).toBeTruthy();
  });

  it("shows a loading row while the model list is pending", async () => {
    apiSpy.models.mockReturnValue(new Promise(() => {}));
    renderGenerate();

    expect(await screen.findByText("Loading…")).toBeTruthy();
    expect(screen.queryByLabelText("Prompt")).toBeNull();
  });

  it("keeps the form usable when models cannot be loaded", async () => {
    apiSpy.models.mockRejectedValue(networkError());
    renderGenerate();
    await settleGenerate("Create music");

    expect(screen.getByText("Could not reach the local Klyraudio service.")).toBeTruthy();
    expect(screen.getByText("No models available.")).toBeTruthy();
    expect(generateButton().disabled).toBe(true);
    expect(screen.getByRole("link", { name: "Open Model Manager" })).toBeTruthy();
  });

  it("requires a prompt of at least two characters", async () => {
    renderGenerate();
    await settleGenerate("Create music");

    fireEvent.click(generateButton());

    expect(
      screen.getAllByText("Write a prompt of at least two characters.").length,
    ).toBeGreaterThan(0);
    expect(apiSpy.generate).not.toHaveBeenCalled();
  });

  it("fills the prompt from a suggestion", async () => {
    renderGenerate();
    await settleGenerate("Create music");

    fireEvent.click(
      screen.getByRole("button", {
        name: "Uplifting cinematic strings with gentle percussion, hopeful and wide",
      }),
    );

    expect(promptBox().value).toBe(
      "Uplifting cinematic strings with gentle percussion, hopeful and wide",
    );
  });

  it("only shows the advanced controls the model supports", async () => {
    renderGenerate();
    await settleGenerate("Create music");

    expect(
      screen.getByText("Model-supported controls: tempo, musical_key, mood, style, instrumental"),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Show advanced options" }));

    expect(screen.getByLabelText("Tempo")).toBeTruthy();
    expect(screen.getByLabelText("Key")).toBeTruthy();
    expect(screen.getByLabelText("Mood")).toBeTruthy();
    expect(screen.getByLabelText("Style")).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Instrumental" })).toBeTruthy();
    expect(screen.queryByLabelText("Quality")).toBeNull();
    expect(screen.queryByLabelText("Guidance")).toBeNull();
    expect(screen.queryByLabelText("Diffusion steps")).toBeNull();
    expect(screen.getByRole("button", { name: "Hide advanced options" })).toBeTruthy();
  });

  it("hides tempo and other unsupported controls for sound effects", async () => {
    renderGenerate("sfx");
    await settleGenerate("Create a sound effect");

    fireEvent.click(screen.getByRole("button", { name: "Show advanced options" }));

    expect(screen.getByLabelText("Mood")).toBeTruthy();
    expect(screen.getByLabelText("Style")).toBeTruthy();
    expect(screen.queryByLabelText("Tempo")).toBeNull();
    expect(screen.queryByRole("switch", { name: "Instrumental" })).toBeNull();
  });

  it("submits the prompt, duration, seed, and advanced values", async () => {
    renderGenerate();
    await settleGenerate("Create music");

    fireEvent.change(promptBox(), { target: { value: "Warm piano for a rainy night" } });
    fireEvent.change(screen.getByLabelText("Duration"), { target: { value: "30" } });
    fireEvent.change(screen.getByLabelText("Variations"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Seed"), { target: { value: "4242" } });
    fireEvent.click(screen.getByRole("button", { name: "Show advanced options" }));
    fireEvent.change(screen.getByLabelText("Tempo"), { target: { value: "128" } });
    fireEvent.change(screen.getByLabelText("Key"), { target: { value: "C minor" } });
    fireEvent.change(screen.getByLabelText("Mood"), { target: { value: "calm" } });
    fireEvent.change(screen.getByLabelText("Style"), { target: { value: "lo-fi" } });
    fireEvent.click(screen.getByRole("switch", { name: "Instrumental" }));

    fireEvent.click(generateButton());

    await waitFor(() =>
      expect(apiSpy.generate).toHaveBeenCalledWith({
        model_id: "klyraudio-sketch",
        task: "music",
        prompt: "Warm piano for a rainy night",
        negative_prompt: "",
        duration: 30,
        seed: 4242,
        variations: 2,
        params: {
          tempo: 128,
          musical_key: "C minor",
          mood: "calm",
          style: "lo-fi",
          instrumental: false,
          loop: false,
          quality: undefined,
          guidance: null,
          steps: null,
        },
      }),
    );
  });

  it("reports the queued jobs and hardware warnings", async () => {
    apiSpy.generate.mockResolvedValue({
      jobs: [
        makeJob({
          id: "job-9",
          task: "music",
          status: "queued",
          prompt: "Warm piano for a rainy night",
          duration_requested: 12,
        }),
      ],
      warnings: [{ level: "warning", message: "Neural models may be slow without a GPU." }],
    });
    renderGenerate();
    await settleGenerate("Create music");

    fireEvent.change(promptBox(), { target: { value: "Warm piano for a rainy night" } });
    fireEvent.click(generateButton());

    expect(
      await screen.findByRole("heading", { level: 2, name: "Generation queued" }),
    ).toBeTruthy();
    const queuedPanel = screen
      .getByRole("heading", { level: 2, name: "Generation queued" })
      .closest("section") as HTMLElement;
    expect(
      within(queuedPanel).getByText(
        "The job is running in your local queue. Open the queue to follow progress.",
      ),
    ).toBeTruthy();
    expect(within(queuedPanel).getByText("Warm piano for a rainy night")).toBeTruthy();
    expect(within(queuedPanel).getByText("0:12")).toBeTruthy();
    expect(within(queuedPanel).getByText("Hardware notes")).toBeTruthy();
    expect(within(queuedPanel).getByText("Neural models may be slow without a GPU.")).toBeTruthy();
    // The heading and the toast both confirm the queued job.
    expect((await screen.findAllByText("Generation queued")).length).toBeGreaterThanOrEqual(2);
    // The dashboard refreshes its recent jobs after a successful submit.
    await waitFor(() => expect(apiSpy.jobs.mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it("shows the service message when generation fails", async () => {
    apiSpy.generate.mockRejectedValue(networkError());
    renderGenerate();
    await settleGenerate("Create music");

    fireEvent.change(promptBox(), { target: { value: "Warm piano" } });
    fireEvent.click(generateButton());

    expect(await screen.findByText("Could not reach the local Klyraudio service.")).toBeTruthy();
    expect(screen.queryByRole("heading", { level: 2, name: "Generation queued" })).toBeNull();
  });

  it("warns and disables generation when the model is not ready", async () => {
    apiSpy.models.mockResolvedValue([
      makeModel({
        availability: "not-installed",
        installed: false,
        availability_detail: "Install it from the Model Manager.",
      }),
    ]);
    renderGenerate();
    await settleGenerate("Create music");

    expect(screen.getByText("This model needs setup before it can generate.")).toBeTruthy();
    expect(screen.getByText("Install it from the Model Manager.")).toBeTruthy();
    expect(generateButton().disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Open Model Manager" }));
    expect(currentLocation()).toEqual({ pathname: "/models", params: {} });
  });

  it("blocks generation until the model license is acknowledged", async () => {
    apiSpy.models.mockResolvedValue([makeNeuralModel({ license_acknowledged: false })]);
    renderGenerate();
    await settleGenerate("Create music");

    expect(screen.getByText("Review the model license before generating with it.")).toBeTruthy();
    expect(screen.getByText("CC BY-NC 4.0")).toBeTruthy();
    expect(generateButton().disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Review license" }));
    expect(currentLocation()).toEqual({ pathname: "/models", params: {} });
  });

  it("explains CPU-only inference", async () => {
    apiSpy.systemInfo.mockResolvedValue(
      makeSystemInfo({ available_backends: ["cpu"], gpus: [], recommended_backend: "cpu" }),
    );
    renderGenerate();
    await settleGenerate("Create music");

    expect(
      await screen.findByText(
        "No GPU is configured for inference. The built-in engine runs well on CPU; neural models may be slow.",
      ),
    ).toBeTruthy();
  });

  it("opens a recent job's output in the editor", async () => {
    apiSpy.jobs.mockResolvedValue([
      makeJob({ id: "job-7", task: "music", prompt: "Old take", output_asset_ids: ["asset-9"] }),
    ]);
    renderGenerate();
    await settleGenerate("Create music");

    expect(await screen.findByText("Old take")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open in editor" }));

    expect(currentLocation()).toEqual({
      pathname: "/editor/asset-9",
      params: { assetId: "asset-9" },
    });
  });

  it("sends a recent job's output to a new Studio project", async () => {
    apiSpy.jobs.mockResolvedValue([
      makeJob({ id: "job-7", task: "music", prompt: "Old take", output_asset_ids: ["asset-9"] }),
    ]);
    apiSpy.asset.mockResolvedValue(makeAsset({ id: "asset-9", name: "Old take.wav" }));
    apiSpy.createProject.mockResolvedValue(makeProjectInfo());
    apiSpy.updateProject.mockResolvedValue(makeProjectInfo());
    renderGenerate();
    await settleGenerate("Create music");

    fireEvent.click(await screen.findByRole("button", { name: "Send to Studio" }));

    await waitFor(() => expect(apiSpy.asset).toHaveBeenCalledWith("asset-9"));
    await waitFor(() =>
      expect(apiSpy.createProject).toHaveBeenCalledWith({
        name: "Old take.wav",
        sample_rate: 44100,
      }),
    );
    await waitFor(() => expect(apiSpy.updateProject).toHaveBeenCalled());
    expect(await screen.findByText("Added to a new Studio project.")).toBeTruthy();
    expect(currentLocation()).toEqual({
      pathname: "/studio/project-1",
      params: { projectId: "project-1" },
    });
  });

  it("randomizes the seed with a non-negative integer", async () => {
    renderGenerate();
    await settleGenerate("Create music");

    fireEvent.click(screen.getByRole("button", { name: "Randomize seed" }));

    expect((screen.getByLabelText("Seed") as HTMLInputElement).value).toMatch(/^\d+$/);
  });

  it("submits an empty seed as null", async () => {
    renderGenerate();
    await settleGenerate("Create music");

    fireEvent.change(promptBox(), { target: { value: "Warm piano" } });
    // The input strips non-digits, so only digits can ever reach the payload.
    fireEvent.change(screen.getByLabelText("Seed"), { target: { value: "abc" } });
    expect((screen.getByLabelText("Seed") as HTMLInputElement).value).toBe("");

    fireEvent.click(generateButton());

    await waitFor(() =>
      expect(apiSpy.generate).toHaveBeenCalledWith(
        expect.objectContaining({ seed: null, prompt: "Warm piano", task: "music" }),
      ),
    );
  });
});
