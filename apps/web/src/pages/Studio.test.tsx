import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import { ApiError } from "../api/client";
import type { ProjectInfo } from "../api/types";
import { LocationProbe, renderPage } from "../test/pages";
import { type ApiSpies, mockApi } from "../test/api";
import {
  makeAsset,
  makeClip,
  makeProjectDocument,
  makeProjectInfo,
  makeTrack,
} from "../test/fixtures";
import { StudioPage } from "./Studio";

function networkError(): ApiError {
  return new ApiError({
    code: "network_error",
    message: "Could not reach the local Klyraudio service.",
    status: 0,
  });
}

function renderStudio(projectId?: string) {
  return renderPage(
    <Routes>
      <Route path="/studio" element={<StudioPage />} />
      <Route path="/studio/:projectId" element={<StudioPage />} />
      <Route path="/editor/:assetId" element={<LocationProbe />} />
    </Routes>,
    { route: projectId ? `/studio/${projectId}` : "/studio" },
  );
}

function loadedProject(overrides: Partial<ProjectInfo> = {}): ProjectInfo {
  return makeProjectInfo({
    id: "project-1",
    name: "Test project",
    track_count: 1,
    duration: 3.5,
    document: makeProjectDocument({ tracks: [makeTrack()] }),
    ...overrides,
  });
}

async function settleProject(name = "Test project") {
  await screen.findByRole("heading", { level: 1, name });
}

async function settleProjectList() {
  await screen.findByRole("heading", { level: 1, name: "Studio" });
  await waitFor(() => expect(screen.queryByText("Loading…")).toBeNull());
}

function selectedClip(name = "Test chime.wav"): HTMLElement {
  const clip = screen.getByRole("button", { name });
  fireEvent.keyDown(clip, { key: "Enter" });
  return clip;
}

function laneWithWidth(container: HTMLElement, width = 600): HTMLElement {
  const lane = container.querySelector(".track-lane") as HTMLElement;
  vi.spyOn(lane, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: width,
    bottom: 76,
    width,
    height: 76,
    toJSON: () => ({}),
  } as DOMRect);
  return lane;
}

describe("StudioPage", () => {
  let apiSpy: ApiSpies;

  beforeEach(() => {
    apiSpy = mockApi();
    const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
    proto.setPointerCapture = () => {};
    proto.releasePointerCapture = () => {};
    proto.hasPointerCapture = () => true;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("shows the empty project list", async () => {
    renderStudio();
    await settleProjectList();

    expect(screen.getByText("No projects yet. Create one to start arranging audio.")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "New project" }).length).toBeGreaterThan(0);
    expect(apiSpy.projects).toHaveBeenCalledTimes(1);
  });

  it("reports a project list failure", async () => {
    apiSpy.projects.mockRejectedValue(networkError());
    renderStudio();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Could not reach the local Klyraudio service.");
  });

  it("lists projects with their counts and opens one", async () => {
    apiSpy.projects.mockResolvedValue([
      makeProjectInfo({
        id: "project-9",
        name: "Night drive",
        track_count: 2,
        duration: 12.4,
      }),
      makeProjectInfo({ id: "project-10", name: "Rain bed", track_count: 0, duration: 0 }),
    ]);
    apiSpy.project.mockResolvedValue(loadedProject());
    renderStudio();
    await settleProjectList();

    expect(screen.getByText("Night drive")).toBeTruthy();
    expect(screen.getByText("2 tracks · 0:12.4")).toBeTruthy();
    expect(screen.getByText("Rain bed")).toBeTruthy();

    fireEvent.click(screen.getAllByRole("button", { name: "Open" })[0]);
    await settleProject();

    expect(apiSpy.project).toHaveBeenCalledWith("project-9");
  });

  it("creates a project with the chosen name and sample rate", async () => {
    renderStudio();
    await settleProjectList();

    fireEvent.click(screen.getAllByRole("button", { name: "New project" })[0]);
    const dialog = await screen.findByRole("dialog", { name: "New project" });
    const create = within(dialog).getByRole("button", {
      name: "Create project",
    }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);

    fireEvent.change(within(dialog).getByLabelText("Project name"), {
      target: { value: "  My mix  " },
    });
    fireEvent.change(within(dialog).getByLabelText("Project sample rate"), {
      target: { value: "48000" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create project" }));

    await settleProject();
    expect(apiSpy.createProject).toHaveBeenCalledWith({ name: "My mix", sample_rate: 48000 });
    expect(apiSpy.project).toHaveBeenCalledWith("project-1");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("deletes a project after confirmation", async () => {
    apiSpy.projects.mockResolvedValue([makeProjectInfo({ name: "Night drive" })]);
    renderStudio();
    await settleProjectList();

    fireEvent.click(screen.getByRole("button", { name: "Delete project" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete project" });
    expect(within(dialog).getByText(/Delete "Night drive"/)).toBeTruthy();

    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(apiSpy.deleteProject).toHaveBeenCalledWith("project-1"));

    expect(screen.getByText("Project deleted.")).toBeTruthy();
    await waitFor(() => expect(apiSpy.projects).toHaveBeenCalledTimes(2));
  });

  it("shows a load error with a way back to the project list", async () => {
    apiSpy.project.mockRejectedValue(networkError());
    renderStudio("project-1");

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Could not reach the local Klyraudio service.");

    fireEvent.click(screen.getByRole("button", { name: "Projects" }));
    await settleProjectList();
    expect(screen.getByText("No projects yet. Create one to start arranging audio.")).toBeTruthy();
  });

  it("renders the project timeline with tracks and clips", async () => {
    apiSpy.project.mockResolvedValue(loadedProject());
    renderStudio("project-1");
    await settleProject();

    expect(screen.getByText("Project length: 0:03.5 · 1 track · 1 clip")).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Track name" })).toHaveProperty("value", "Track 1");
    expect(screen.getByRole("button", { name: "Test chime.wav" })).toBeTruthy();
    expect(screen.getByText("0:00 / 0:03.5")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Play" })).toBeTruthy();
    expect(screen.queryByText("This project is empty")).toBeNull();
  });

  it("shows the empty timeline for a project without tracks", async () => {
    apiSpy.project.mockResolvedValue(makeProjectInfo());
    renderStudio("project-1");
    await settleProject();

    expect(screen.getByText("Project length: 0:00 · 0 tracks · 0 clips")).toBeTruthy();
    expect(screen.getByText("This project is empty")).toBeTruthy();
    expect(
      screen.getByText("Add audio from the library, then drag clips along the timeline."),
    ).toBeTruthy();
    expect((screen.getByRole("button", { name: "Play" }) as HTMLButtonElement).disabled).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Render and export" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("marks clips whose audio is no longer available", async () => {
    apiSpy.project.mockResolvedValue(
      loadedProject({
        document: makeProjectDocument({
          tracks: [makeTrack({ clips: [makeClip({ asset_id: "asset-404" })] })],
        }),
      }),
    );
    apiSpy.asset.mockRejectedValue(networkError());
    renderStudio("project-1");
    await settleProject();

    const clip = screen.getByRole("button", {
      name: "A clip references audio that is no longer available.",
    });
    fireEvent.keyDown(clip, { key: "Enter" });
    expect(
      screen.getAllByText("A clip references audio that is no longer available.").length,
    ).toBeGreaterThan(1);
  });

  it("adds a track and marks the project dirty", async () => {
    apiSpy.project.mockResolvedValue(loadedProject());
    renderStudio("project-1");
    await settleProject();

    fireEvent.click(screen.getByRole("button", { name: "Add track" }));

    expect(screen.getAllByRole("textbox", { name: "Track name" })).toHaveLength(2);
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
    expect(screen.getByText(/2 tracks/)).toBeTruthy();
  });

  it("adds an asset from the library picker to the timeline", async () => {
    apiSpy.project.mockResolvedValue(makeProjectInfo());
    apiSpy.assets.mockResolvedValue({ items: [makeAsset()], total: 1 });
    const { container } = renderStudio("project-1");
    await settleProject();

    fireEvent.click(screen.getByRole("button", { name: "Add audio" }));
    const picker = await screen.findByRole("dialog", { name: "Choose audio to add" });
    await within(picker).findByText("Test chime.wav");
    fireEvent.click(within(picker).getByRole("button", { name: /Test chime.wav/ }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("button", { name: "Test chime.wav" })).toBeTruthy();
    expect(screen.getByText(/1 track · 1 clip/)).toBeTruthy();
    expect(container.querySelector(".clip-inspector")).toBeTruthy();
  });

  it("edits clip ranges and duplicates or removes the selection", async () => {
    apiSpy.project.mockResolvedValue(loadedProject());
    renderStudio("project-1");
    await settleProject();
    selectedClip();

    expect(screen.getByText("Clip gain")).toBeTruthy();
    expect(screen.getByText("Source offset")).toBeTruthy();
    expect(screen.getByText("Clip length")).toBeTruthy();
    expect(screen.getByText("Track 1 · 0:03.5")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Clip gain"), { target: { value: "0.5" } });
    expect(screen.getByText("50%")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Duplicate clip" }));
    expect(screen.getByText("Clip duplicated.")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Test chime.wav" })).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "Remove clip" }));
    expect(screen.getAllByRole("button", { name: "Test chime.wav" })).toHaveLength(1);

    selectedClip();
    fireEvent.click(screen.getByRole("button", { name: "Remove clip" }));
    expect(screen.queryAllByRole("button", { name: "Test chime.wav" })).toHaveLength(0);
    expect(
      screen.getByText("Add audio from the library, then drag clips along the timeline."),
    ).toBeTruthy();
  });

  it("splits a clip at the playhead and warns when the playhead is outside it", async () => {
    apiSpy.project.mockResolvedValue(loadedProject());
    const { container } = renderStudio("project-1");
    await settleProject();

    selectedClip();
    fireEvent.click(screen.getByRole("button", { name: "Split clip at playhead" }));
    expect(
      screen.getByText("Split clip at playhead", { selector: ".toast__body span" }),
    ).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Test chime.wav" })).toHaveLength(1);

    const lane = laneWithWidth(container);
    fireEvent.pointerDown(lane, { clientX: 105, pointerId: 1 });
    selectedClip();
    fireEvent.click(screen.getByRole("button", { name: "Split clip at playhead" }));

    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: "Test chime.wav" })).toHaveLength(2),
    );
  });

  it("updates the master volume, normalize switch, and autosave toggle", async () => {
    apiSpy.project.mockResolvedValue(loadedProject());
    renderStudio("project-1");
    await settleProject();

    fireEvent.change(screen.getByLabelText("Master volume"), { target: { value: "0.5" } });
    expect(screen.getByText("50%")).toBeTruthy();
    expect(screen.getByText("Unsaved changes")).toBeTruthy();

    const normalize = screen.getByRole("switch", { name: "Normalize peak" });
    expect(normalize.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(normalize);
    expect(normalize.getAttribute("aria-checked")).toBe("true");

    const autosave = screen.getByRole("switch", { name: "Autosave" });
    expect(autosave.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(autosave);
    expect(autosave.getAttribute("aria-checked")).toBe("false");
  });

  it("saves the document explicitly", async () => {
    const project = loadedProject();
    apiSpy.project.mockResolvedValue(project);
    apiSpy.updateProject.mockResolvedValue(project);
    renderStudio("project-1");
    await settleProject();

    fireEvent.change(screen.getByLabelText("Master volume"), { target: { value: "0.25" } });
    fireEvent.click(screen.getByRole("button", { name: "Save project" }));

    await waitFor(() => expect(apiSpy.updateProject).toHaveBeenCalledTimes(1));
    const [projectId, payload] = apiSpy.updateProject.mock.calls[0];
    expect(projectId).toBe("project-1");
    expect(payload.autosave).toBe(false);
    expect(payload.document.master.volume).toBe(0.25);
    await screen.findByText(/^Saved /);
  });

  it("reports a save failure without clearing the dirty state", async () => {
    apiSpy.project.mockResolvedValue(loadedProject());
    apiSpy.updateProject.mockRejectedValue(networkError());
    renderStudio("project-1");
    await settleProject();

    fireEvent.change(screen.getByLabelText("Master volume"), { target: { value: "0.25" } });
    fireEvent.click(screen.getByRole("button", { name: "Save project" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("The project could not be saved.");
    expect(alert.textContent).toContain("Could not reach the local Klyraudio service.");
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
  });

  it("autosaves after the debounce and stops when autosave is off", async () => {
    const project = loadedProject();
    apiSpy.project.mockResolvedValue(project);
    apiSpy.updateProject.mockResolvedValue(project);
    renderStudio("project-1");
    await settleProject();

    vi.useFakeTimers();
    fireEvent.change(screen.getByLabelText("Master volume"), { target: { value: "0.4" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1900);
    });
    expect(apiSpy.updateProject).toHaveBeenCalledWith(
      "project-1",
      expect.objectContaining({ autosave: true }),
    );

    fireEvent.click(screen.getByRole("switch", { name: "Autosave" }));
    fireEvent.change(screen.getByLabelText("Master volume"), { target: { value: "0.3" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1900);
    });
    expect(apiSpy.updateProject).toHaveBeenCalledTimes(1);
  });

  it("renders the mix, opens the export dialog, and opens the render in the editor", async () => {
    const project = loadedProject();
    apiSpy.project.mockResolvedValue(project);
    apiSpy.updateProject.mockResolvedValue(project);
    renderStudio("project-1");
    await settleProject();

    fireEvent.click(screen.getByRole("button", { name: "Render and export" }));

    const dialog = await screen.findByRole("dialog", { name: "Export audio" });
    await within(dialog).findByText("Render.wav");
    expect(apiSpy.renderProject).toHaveBeenCalledWith("project-1", {
      format: "wav",
      normalize: false,
    });
    expect(screen.getByText("Mix rendered and added to the library.")).toBeTruthy();

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    expect(screen.getByRole("button", { name: "Export mix" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open mix in editor" }));
    await screen.findByTestId("location");

    expect(JSON.parse(screen.getByTestId("location").textContent ?? "{}")).toEqual({
      pathname: "/editor/rendered-1",
      params: { assetId: "rendered-1" },
    });
  });

  it("adds, toggles, and removes a master effect", async () => {
    apiSpy.project.mockResolvedValue(loadedProject());
    const { container } = renderStudio("project-1");
    await settleProject();
    expect(container.querySelector(".effect-card")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Add effect" }));
    expect(screen.getByText("Effect added.")).toBeTruthy();
    const card = container.querySelector(".effect-card") as HTMLElement;
    expect(card.textContent).toContain("Equalizer");
    expect(screen.getByLabelText("Low gain")).toBeTruthy();

    const enabled = screen.getByRole("switch", { name: "Enabled" });
    expect(enabled.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(enabled);
    expect(enabled.getAttribute("aria-checked")).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: "Remove effect" }));
    expect(container.querySelector(".effect-card")).toBeNull();
    expect(screen.getByText("Master effects are applied during rendering.")).toBeTruthy();
  });

  it("zooms the timeline and adjusts track volume, pan, mute, and solo", async () => {
    apiSpy.project.mockResolvedValue(loadedProject());
    const { container } = renderStudio("project-1");
    await settleProject();

    expect(screen.getByText("60 px/s")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(screen.getByText("84 px/s")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    expect(screen.getByText("60 px/s")).toBeTruthy();

    fireEvent.change(screen.getByRole("slider", { name: "Track 1 Volume" }), {
      target: { value: "0.5" },
    });
    fireEvent.change(screen.getByRole("slider", { name: "Track 1 Pan" }), {
      target: { value: "-0.5" },
    });
    const lane = laneWithWidth(container);
    fireEvent.pointerDown(lane, { clientX: 0, pointerId: 1 });
    selectedClip();
    expect(screen.getByText(/Left 50%/)).toBeTruthy();

    const mute = screen.getByTitle("Mute");
    const solo = screen.getByTitle("Solo");
    expect(mute.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(mute);
    expect(mute.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(solo);
    expect(solo.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
  });
});
