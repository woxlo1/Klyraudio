import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import { ApiError } from "../api/client";
import { LocationProbe, renderPage } from "../test/pages";
import { type ApiSpies, mockApi } from "../test/api";
import { makeAsset } from "../test/fixtures";
import { EditorPage } from "./Editor";

function networkError(): ApiError {
  return new ApiError({
    code: "network_error",
    message: "Could not reach the local Klyraudio service.",
    status: 0,
  });
}

function renderEditor(assetId?: string) {
  return renderPage(
    <Routes>
      <Route path="/editor" element={<EditorPage />} />
      <Route path="/editor/:assetId" element={<EditorPage />} />
      <Route path="/library" element={<LocationProbe />} />
      <Route path="/studio/:projectId" element={<LocationProbe />} />
    </Routes>,
    { route: assetId ? `/editor/${assetId}` : "/editor" },
  );
}

async function settleEditor(name = "Test chime.wav") {
  await screen.findByRole("heading", { level: 1, name: `Edit — ${name}` });
}

function canvasWithRect(width = 1000): HTMLCanvasElement {
  const canvas = screen.getByRole("img", { name: /Audio waveform/ }) as HTMLCanvasElement;
  vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: width,
    bottom: 148,
    width,
    height: 148,
    toJSON: () => ({}),
  } as DOMRect);
  return canvas;
}

function dragSelection(fromRatio: number, toRatio: number) {
  const canvas = canvasWithRect();
  fireEvent.pointerDown(canvas, { clientX: 1000 * fromRatio, pointerId: 1 });
  fireEvent.pointerMove(canvas, { clientX: 1000 * toRatio, pointerId: 1 });
  fireEvent.pointerUp(canvas, { clientX: 1000 * toRatio, pointerId: 1 });
}

function seekTo(ratio: number) {
  const canvas = canvasWithRect();
  fireEvent.pointerDown(canvas, { clientX: 1000 * ratio, pointerId: 1 });
  fireEvent.pointerUp(canvas, { clientX: 1000 * ratio, pointerId: 1 });
}

function historyPanel(): HTMLElement {
  const heading = screen.getByRole("heading", { level: 2, name: "History" });
  return heading.closest("section") as HTMLElement;
}

describe("EditorPage", () => {
  let apiSpy: ApiSpies;
  let playSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    apiSpy = mockApi();
    playSpy = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      () =>
        ({
          setTransform: () => {},
          clearRect: () => {},
          beginPath: () => {},
          moveTo: () => {},
          lineTo: () => {},
          stroke: () => {},
          fillRect: () => {},
        }) as unknown as CanvasRenderingContext2D,
    );
    const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
    proto.setPointerCapture = () => {};
    proto.releasePointerCapture = () => {};
    proto.hasPointerCapture = () => true;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("explains how to pick audio when no asset is selected", () => {
    renderEditor();

    expect(screen.getByRole("heading", { level: 1, name: "Editor" })).toBeTruthy();
    expect(screen.getByText("Choose audio to edit")).toBeTruthy();
    expect(screen.getByText(/Edits create a new file and keep the original/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Choose an audio file" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Import audio" })).toHaveLength(2);
    expect(screen.getByRole("link", { name: "Open library" })).toBeTruthy();
  });

  it("loads the asset from the route and requests its waveform", async () => {
    renderEditor("asset-1");
    await settleEditor();

    expect(apiSpy.asset).toHaveBeenCalledWith("asset-1");
    expect(apiSpy.waveform).toHaveBeenCalledWith("asset-1", 1600);
    expect(screen.getByText("0:03.5 · 44100 Hz · Stereo · WAV")).toBeTruthy();
    expect(screen.getByRole("img", { name: "Audio waveform: Test chime.wav" })).toBeTruthy();
    expect(screen.getByText("Waveform")).toBeTruthy();
    expect(screen.getByText("Drag across the waveform to select a range.")).toBeTruthy();
    expect(screen.getByText("Working copy: Test chime.wav")).toBeTruthy();
    expect(within(historyPanel()).getByText("Source")).toBeTruthy();
    expect(within(historyPanel()).getByText("Test chime.wav")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Undo" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Redo" }) as HTMLButtonElement).disabled).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Trim to selection" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Silence selection" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Play selection" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("reports a route load failure and keeps the empty state", async () => {
    apiSpy.asset.mockRejectedValue(networkError());
    renderEditor("missing");

    await screen.findByText("Could not reach the local Klyraudio service.");
    expect(screen.getByText("Choose audio to edit")).toBeTruthy();
  });

  it("enables range operations only after selecting part of the waveform", async () => {
    renderEditor("asset-1");
    await settleEditor();

    dragSelection(0.2, 0.6);

    expect(screen.getByText("Selection:")).toBeTruthy();
    expect(screen.getByText(/Selection: 0:01\.\d/)).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Trim to selection" }) as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(
      (screen.getByRole("button", { name: "Silence selection" }) as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(
      (screen.getByRole("button", { name: "Play selection" }) as HTMLButtonElement).disabled,
    ).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Play selection" }));
    await waitFor(() => expect(playSpy).toHaveBeenCalled());
  });

  it("applies the trim payload, appends history, and supports undo and redo", async () => {
    renderEditor("asset-1");
    await settleEditor();
    dragSelection(0.2, 0.6);

    fireEvent.click(screen.getByRole("button", { name: "Trim to selection" }));
    await settleEditor("Edited take.wav");

    expect(apiSpy.operate).toHaveBeenCalledWith(
      "asset-1",
      expect.objectContaining({ operation: "trim" }),
    );
    const payload = apiSpy.operate.mock.calls[0][1];
    expect(payload.start).toBeCloseTo(0.7, 5);
    expect(payload.end).toBeCloseTo(2.1, 5);
    expect(screen.getByText("Trim to selection applied.")).toBeTruthy();
    expect(within(historyPanel()).getByText("Trim to selection")).toBeTruthy();
    expect(within(historyPanel()).getByText("Edited take.wav")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await settleEditor();

    fireEvent.click(screen.getByRole("button", { name: "Redo" }));
    await settleEditor("Edited take.wav");

    const sourceEntry = within(historyPanel())
      .getAllByRole("button")
      .find((button) => button.textContent?.includes("Test chime.wav"));
    expect(sourceEntry).toBeTruthy();
    fireEvent.click(sourceEntry as HTMLButtonElement);
    await settleEditor();
  });

  it("sends the configured gain and fade amounts with each operation", async () => {
    renderEditor("asset-1");
    await settleEditor();

    fireEvent.change(screen.getByLabelText("Gain amount"), { target: { value: "-6.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Gain (-6.5 dB)" }));
    await waitFor(() => expect(apiSpy.operate).toHaveBeenCalledTimes(1));
    expect(apiSpy.operate.mock.calls[0][1]).toEqual(
      expect.objectContaining({ operation: "gain", amount: -6.5 }),
    );

    fireEvent.change(screen.getByLabelText("Fade duration"), { target: { value: "1.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Fade in" }));
    await waitFor(() => expect(apiSpy.operate).toHaveBeenCalledTimes(2));
    expect(apiSpy.operate.mock.calls[1][1]).toEqual(
      expect.objectContaining({ operation: "fade_in", amount: 1.5 }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Create loop" }));
    await waitFor(() => expect(apiSpy.operate).toHaveBeenCalledTimes(3));
    expect(apiSpy.operate.mock.calls[2][1]).toEqual(
      expect.objectContaining({ operation: "loop", crossfade: 1 }),
    );
  });

  it("requires a playhead inside the clip before splitting", async () => {
    renderEditor("asset-1");
    await settleEditor();

    fireEvent.click(screen.getByRole("button", { name: "Split at playhead" }));
    expect(screen.getByText("Place the playhead inside the audio first.")).toBeTruthy();
    expect(apiSpy.operate).not.toHaveBeenCalled();

    seekTo(0.5);
    expect(screen.getByText("Playhead: 0:01.7")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Split at playhead" }));

    await waitFor(() => expect(apiSpy.operate).toHaveBeenCalledTimes(1));
    expect(apiSpy.operate.mock.calls[0][1]).toEqual(
      expect.objectContaining({ operation: "split", start: 1.75 }),
    );
  });

  it("imports a local file, loads it, and follows it in the route", async () => {
    const imported = makeAsset({ id: "imported-1", name: "Imported take.wav", origin: "imported" });
    apiSpy.importAsset.mockResolvedValue(imported);
    apiSpy.asset.mockResolvedValue(imported);
    const { container } = renderEditor();
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["audio"], "new-take.wav", { type: "audio/wav" });

    fireEvent.change(input, { target: { files: [file] } });
    await settleEditor("Imported take.wav");

    expect(apiSpy.importAsset).toHaveBeenCalledWith(file, "other");
    expect(screen.getByText("Audio imported.")).toBeTruthy();
    expect(input.value).toBe("");
  });

  it("opens the library picker and loads the chosen asset", async () => {
    const rain = makeAsset({ id: "asset-2", name: "Rain loop.wav", duration: 12.4 });
    apiSpy.assets.mockResolvedValue({ items: [makeAsset(), rain], total: 2 });
    apiSpy.asset.mockImplementation(async (assetId) =>
      assetId === "asset-2" ? rain : makeAsset(),
    );
    renderEditor();

    fireEvent.click(screen.getByRole("button", { name: "Choose an audio file" }));
    const picker = await screen.findByRole("dialog", { name: "Choose an audio file" });
    await within(picker).findByText("Rain loop.wav");

    fireEvent.click(within(picker).getByRole("button", { name: /Rain loop.wav/ }));
    await settleEditor("Rain loop.wav");

    expect(apiSpy.asset).toHaveBeenCalledWith("asset-2");
    expect(apiSpy.waveform).toHaveBeenCalledWith("asset-2", 1600);
  });

  it("joins the selected assets with the configured crossfade", async () => {
    const rain = makeAsset({ id: "asset-2", name: "Rain loop.wav", duration: 12.4 });
    apiSpy.assets.mockResolvedValue({ items: [makeAsset(), rain], total: 2 });
    renderEditor("asset-1");
    await settleEditor();

    fireEvent.click(screen.getByRole("button", { name: "Join audio files" }));
    const joinDialog = await screen.findByRole("dialog", { name: "Join audio files" });
    expect(
      (within(joinDialog).getByRole("button", { name: "Join selected" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);

    fireEvent.click(within(joinDialog).getByRole("button", { name: "Choose an audio file" }));
    await waitFor(() => expect(screen.getAllByRole("dialog")).toHaveLength(2));
    const picker = screen.getAllByRole("dialog").at(-1) as HTMLElement;
    await within(picker).findByText("Rain loop.wav");

    fireEvent.click(within(picker).getByRole("button", { name: /Test chime.wav/ }));
    fireEvent.click(within(picker).getByRole("button", { name: /Rain loop.wav/ }));
    fireEvent.click(within(picker).getByRole("button", { name: "Join selected (2)" }));

    await waitFor(() => expect(screen.getAllByRole("dialog")).toHaveLength(1));
    fireEvent.click(
      within(joinDialog).getByRole("button", { name: "Join selected" }) as HTMLButtonElement,
    );
    await settleEditor("Joined take.wav");

    expect(apiSpy.joinAssets).toHaveBeenCalledWith({
      asset_ids: ["asset-1", "asset-2"],
      crossfade: 1,
    });
    expect(screen.getByText("Audio joined.")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens the export dialog and exports the working copy", async () => {
    renderEditor("asset-1");
    await settleEditor();

    fireEvent.click(screen.getAllByRole("button", { name: "Export" })[0]);
    const dialog = await screen.findByRole("dialog", { name: "Export audio" });
    await within(dialog).findByDisplayValue("Test chime.wav");

    fireEvent.click(within(dialog).getByRole("button", { name: "Export" }));

    await screen.findByRole("heading", { name: "Export complete" });
    expect(apiSpy.exportAudio).toHaveBeenCalledWith(
      expect.objectContaining({
        asset_id: "asset-1",
        format: "wav",
        sample_rate: 44100,
        channels: 2,
        bit_depth: 24,
        bitrate_kbps: null,
        normalize_peak_db: null,
        dither: false,
        filename: "Test chime.wav",
      }),
    );
    expect(screen.getByText("/home/tester/Klyraudio/exports/Test chime.wav")).toBeTruthy();
  });

  it("creates a Studio project from the working copy and navigates to it", async () => {
    renderEditor("asset-1");
    await settleEditor();

    fireEvent.click(screen.getByRole("button", { name: "Add to Studio" }));
    await screen.findByTestId("location");

    expect(apiSpy.createProject).toHaveBeenCalledWith({
      name: "Test chime.wav",
      sample_rate: 44100,
    });
    expect(apiSpy.updateProject).toHaveBeenCalledTimes(1);
    expect(JSON.parse(screen.getByTestId("location").textContent ?? "{}")).toEqual({
      pathname: "/studio/project-1",
      params: { projectId: "project-1" },
    });
    expect(screen.getByText("Added to a new Studio project.")).toBeTruthy();
  });

  it("zooms the waveform and keeps the zoom in range", async () => {
    renderEditor("asset-1");
    await settleEditor();

    expect(screen.getByText("1.0×")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Zoom out" }) as HTMLButtonElement).disabled).toBe(
      true,
    );

    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(screen.getByText("1.5×")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Zoom out" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it("opens the join dialog directly from the header and closes it", async () => {
    renderEditor("asset-1");
    await settleEditor();

    fireEvent.click(screen.getByRole("button", { name: "Join audio files" }));
    const dialog = await screen.findByRole("dialog", { name: "Join audio files" });
    expect(within(dialog).getAllByText(/Select files in order/).length).toBeGreaterThan(0);
    expect(within(dialog).getByLabelText("Crossfade")).toBeTruthy();

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});
