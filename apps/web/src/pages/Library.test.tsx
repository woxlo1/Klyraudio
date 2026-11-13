import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import { ApiError } from "../api/client";
import { LocationProbe, renderPage } from "../test/pages";
import { type ApiSpies, mockApi } from "../test/api";
import { makeAsset, makeProjectInfo } from "../test/fixtures";
import { LibraryPage } from "./Library";

function networkError(): ApiError {
  return new ApiError({
    code: "network_error",
    message: "Could not reach the local Klyraudio service.",
    status: 0,
  });
}

function renderLibrary() {
  return renderPage(
    <Routes>
      <Route path="/library" element={<LibraryPage />} />
      <Route path="/generate/:task" element={<LocationProbe />} />
      <Route path="/editor/:assetId" element={<LocationProbe />} />
      <Route path="/studio/:projectId" element={<LocationProbe />} />
    </Routes>,
    { route: "/library" },
  );
}

async function settleLibrary() {
  await screen.findByRole("heading", { level: 1, name: "Audio library" });
  await waitFor(() => expect(screen.queryByText("Loading…")).toBeNull());
}

function lastAssetQuery() {
  return apiCall(apiSpyRef, "assets");
}

let apiSpyRef: ApiSpies;

function apiCall(spies: ApiSpies, method: keyof ApiSpies) {
  const spy = spies[method];
  return spy.mock.calls[spy.mock.calls.length - 1]?.[0];
}

describe("LibraryPage", () => {
  let apiSpy: ApiSpies;

  beforeEach(() => {
    apiSpy = mockApi();
    apiSpyRef = apiSpy;
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists assets with their metadata, tags, and pagination state", async () => {
    apiSpy.assets.mockResolvedValue({
      items: [
        makeAsset(),
        makeAsset({
          id: "asset-2",
          name: "Rain loop.wav",
          origin: "imported",
          media_type: "ambient",
          duration: 12.4,
          tags: ["rain", "loop", "nature", "calm"],
          favorite: true,
        }),
      ],
      total: 2,
    });
    renderLibrary();
    await settleLibrary();

    expect(screen.getByText("2 total")).toBeTruthy();
    expect(screen.getByText("Test chime.wav")).toBeTruthy();
    expect(screen.getByText("Rain loop.wav")).toBeTruthy();
    expect(screen.getByText("Sound effects · Generated")).toBeTruthy();
    expect(screen.getByText("Ambient · Imported")).toBeTruthy();
    expect(screen.getByText("0:03.5")).toBeTruthy();
    expect(screen.getByText("0:12.4")).toBeTruthy();
    expect(screen.getByText("rain")).toBeTruthy();
    expect(screen.getByText("loop")).toBeTruthy();
    // Only the first three tags are shown on a card.
    expect(screen.queryByText("calm")).toBeNull();

    const previous = screen.getByRole("button", { name: "Previous page" }) as HTMLButtonElement;
    const next = screen.getByRole("button", { name: "Next page" }) as HTMLButtonElement;
    expect(previous.disabled).toBe(true);
    expect(next.disabled).toBe(true);
    expect(screen.getByText("Page 1")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove from favorites" })).toBeTruthy();
  });

  it("offers a way to start creating when the library is empty", async () => {
    renderLibrary();
    await settleLibrary();

    expect(screen.getByText("Your library is empty")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Create music" }));

    expect(JSON.parse(screen.getByTestId("location").textContent ?? "{}")).toEqual({
      pathname: "/generate/music",
      params: { task: "music" },
    });
  });

  it("passes the search text to the API after the debounce", async () => {
    renderLibrary();
    await settleLibrary();

    fireEvent.change(screen.getByRole("textbox", { name: "Search" }), {
      target: { value: "rain" },
    });

    await waitFor(
      () => {
        expect(lastAssetQuery()).toEqual(
          expect.objectContaining({ query: "rain", limit: 24, offset: 0 }),
        );
      },
      { timeout: 2000 },
    );
    // The filtered empty state and the filter panel both offer to clear.
    expect(screen.getAllByRole("button", { name: "Clear filters" })).toHaveLength(2);
  });

  it("passes type, source, sort, and favorite filters", async () => {
    renderLibrary();
    await settleLibrary();

    fireEvent.change(screen.getByRole("combobox", { name: "Type" }), {
      target: { value: "sfx" },
    });
    await waitFor(() =>
      expect(lastAssetQuery()).toEqual(expect.objectContaining({ media_type: "sfx" })),
    );

    fireEvent.change(screen.getByRole("combobox", { name: "Source" }), {
      target: { value: "imported" },
    });
    await waitFor(() =>
      expect(lastAssetQuery()).toEqual(expect.objectContaining({ origin: "imported" })),
    );

    fireEvent.change(screen.getByRole("combobox", { name: "Sort" }), {
      target: { value: "name" },
    });
    await waitFor(() =>
      expect(lastAssetQuery()).toEqual(expect.objectContaining({ sort: "name" })),
    );

    fireEvent.click(screen.getByRole("button", { name: "Favorites only" }));
    await waitFor(() =>
      expect(lastAssetQuery()).toEqual(expect.objectContaining({ favorite: true })),
    );
  });

  it("clears every filter", async () => {
    renderLibrary();
    await settleLibrary();

    fireEvent.change(screen.getByRole("textbox", { name: "Search" }), {
      target: { value: "rain" },
    });
    await waitFor(
      () => expect(lastAssetQuery()).toEqual(expect.objectContaining({ query: "rain" })),
      { timeout: 2000 },
    );

    fireEvent.click(screen.getAllByRole("button", { name: "Clear filters" })[0]);

    await waitFor(() => {
      expect(lastAssetQuery()).toEqual(
        expect.objectContaining({
          query: undefined,
          media_type: undefined,
          origin: undefined,
          favorite: undefined,
          tag: undefined,
          sort: "newest",
        }),
      );
    });
    expect(screen.queryByRole("button", { name: "Clear filters" })).toBeNull();
  });

  it("filters by a tag counted by the service", async () => {
    apiSpy.assetTags.mockResolvedValue([{ tag: "rain", count: 3 }]);
    renderLibrary();
    await settleLibrary();

    expect(
      within(screen.getByRole("combobox", { name: "Tags" })).getByRole("option", {
        name: "rain (3)",
      }),
    ).toBeTruthy();

    fireEvent.change(screen.getByRole("combobox", { name: "Tags" }), {
      target: { value: "rain" },
    });

    await waitFor(() => expect(lastAssetQuery()).toEqual(expect.objectContaining({ tag: "rain" })));
  });

  it("pages through a larger result set", async () => {
    apiSpy.assets.mockResolvedValue({ items: [makeAsset()], total: 30 });
    renderLibrary();
    await settleLibrary();

    const next = screen.getByRole("button", { name: "Next page" }) as HTMLButtonElement;
    expect(next.disabled).toBe(false);
    fireEvent.click(next);

    await waitFor(() => expect(lastAssetQuery()).toEqual(expect.objectContaining({ offset: 24 })));
    expect(screen.getByText("Page 2")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Previous page" }));
    await waitFor(() => expect(lastAssetQuery()).toEqual(expect.objectContaining({ offset: 0 })));
    expect(screen.getByText("Page 1")).toBeTruthy();
  });

  it("toggles a favorite in place", async () => {
    apiSpy.assets.mockResolvedValue({ items: [makeAsset()], total: 1 });
    apiSpy.updateAsset.mockResolvedValue(makeAsset({ favorite: true }));
    renderLibrary();
    await settleLibrary();

    fireEvent.click(screen.getByRole("button", { name: "Favorite" }));

    await waitFor(() =>
      expect(apiSpy.updateAsset).toHaveBeenCalledWith("asset-1", { favorite: true }),
    );
    expect(await screen.findByText("Added to favorites.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove from favorites" })).toBeTruthy();
  });

  it("opens the compact player for an asset", async () => {
    apiSpy.assets.mockResolvedValue({ items: [makeAsset()], total: 1 });
    renderLibrary();
    await settleLibrary();

    fireEvent.click(screen.getByRole("button", { name: "Play" }));

    expect(apiSpy.audioUrl).toHaveBeenCalledWith("asset-1");
    expect(screen.getAllByText("Test chime.wav")).toHaveLength(2);
    const audio = document.querySelector("audio");
    expect(audio?.getAttribute("src")).toBe("/api/assets/asset-1/audio");

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.getAllByText("Test chime.wav")).toHaveLength(1);
  });

  it("edits asset metadata and tags", async () => {
    apiSpy.assets.mockResolvedValue({ items: [makeAsset()], total: 1 });
    apiSpy.updateAsset.mockResolvedValue(
      makeAsset({
        name: "New name.wav",
        notes: "Recorded at night.",
        media_type: "ambient",
        tags: ["drums"],
      }),
    );
    renderLibrary();
    await settleLibrary();

    fireEvent.click(screen.getByRole("button", { name: "Test chime.wav" }));
    const dialog = screen.getByRole("dialog", { name: "Audio details" });

    expect(within(dialog).getByText("44.1 kHz")).toBeTruthy();
    expect(within(dialog).getByText("Stereo")).toBeTruthy();
    expect(within(dialog).getByText("WAV")).toBeTruthy();
    expect(within(dialog).getByText("602 KB")).toBeTruthy();

    fireEvent.change(within(dialog).getByLabelText("Name"), {
      target: { value: "New name.wav" },
    });
    fireEvent.change(within(dialog).getByLabelText("Notes"), {
      target: { value: "Recorded at night." },
    });
    fireEvent.change(within(dialog).getByLabelText("Type"), {
      target: { value: "ambient" },
    });

    const tagInput = within(dialog).getByLabelText("Tags");
    fireEvent.change(tagInput, { target: { value: "drums" } });
    fireEvent.keyDown(tagInput, { key: "Enter" });
    expect(within(dialog).getByRole("button", { name: "Remove tag drums" })).toBeTruthy();

    fireEvent.click(within(dialog).getByRole("button", { name: "Save tags" }));

    await waitFor(() =>
      expect(apiSpy.updateAsset).toHaveBeenCalledWith("asset-1", {
        name: "New name.wav",
        notes: "Recorded at night.",
        media_type: "ambient",
        tags: ["drums"],
      }),
    );
    expect(await screen.findByText("Saved")).toBeTruthy();
  });

  it("deletes an asset after confirmation", async () => {
    apiSpy.assets.mockResolvedValue({ items: [makeAsset()], total: 1 });
    renderLibrary();
    await settleLibrary();

    fireEvent.click(screen.getByRole("button", { name: "Audio details" }));
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "Audio details" })).getByRole("button", {
        name: "Delete",
      }),
    );

    const confirm = screen.getByRole("dialog", { name: "Delete audio?" });
    expect(within(confirm).getByText(/Test chime\.wav/)).toBeTruthy();
    fireEvent.click(within(confirm).getByRole("button", { name: "Delete audio" }));

    await waitFor(() => expect(apiSpy.deleteAsset).toHaveBeenCalledWith("asset-1"));
    expect(await screen.findByText("Audio deleted.")).toBeTruthy();
    await waitFor(() => expect(apiSpy.assets).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("joins selected assets into one file", async () => {
    apiSpy.assets.mockResolvedValue({
      items: [makeAsset(), makeAsset({ id: "asset-2", name: "Second take.wav" })],
      total: 2,
    });
    renderLibrary();
    await settleLibrary();

    fireEvent.click(screen.getByRole("button", { name: "Select" }));
    fireEvent.click(screen.getByRole("button", { name: "Test chime.wav" }));
    fireEvent.click(screen.getByRole("button", { name: "Second take.wav" }));

    expect(screen.getByRole("region", { name: "2 selected" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Join selected" }));

    await waitFor(() =>
      expect(apiSpy.joinAssets).toHaveBeenCalledWith({
        asset_ids: ["asset-1", "asset-2"],
        crossfade: 0.05,
      }),
    );
    expect(await screen.findByText("Audio joined.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Select" })).toBeTruthy();
    expect(screen.getByRole("dialog", { name: "Audio details" })).toBeTruthy();
    expect(screen.getByText("Joined take.wav")).toBeTruthy();
  });

  it("requires at least two assets before joining", async () => {
    apiSpy.assets.mockResolvedValue({ items: [makeAsset()], total: 1 });
    renderLibrary();
    await settleLibrary();

    fireEvent.click(screen.getByRole("button", { name: "Select" }));
    fireEvent.click(screen.getByRole("button", { name: "Test chime.wav" }));
    fireEvent.click(screen.getByRole("button", { name: "Join selected" }));

    expect(await screen.findByText("Select at least two files to join.")).toBeTruthy();
    expect(apiSpy.joinAssets).not.toHaveBeenCalled();
  });

  it("sends an asset to a new Studio project", async () => {
    apiSpy.assets.mockResolvedValue({ items: [makeAsset()], total: 1 });
    apiSpy.createProject.mockResolvedValue(makeProjectInfo());
    apiSpy.updateProject.mockResolvedValue(makeProjectInfo());
    renderLibrary();
    await settleLibrary();

    fireEvent.click(screen.getByRole("button", { name: "Audio details" }));
    fireEvent.click(screen.getByRole("button", { name: "Add to Studio" }));

    await waitFor(() =>
      expect(apiSpy.createProject).toHaveBeenCalledWith({
        name: "Test chime.wav",
        sample_rate: 44100,
      }),
    );
    await waitFor(() => expect(apiSpy.updateProject).toHaveBeenCalled());
    const [projectId, update] = apiSpy.updateProject.mock.calls[0];
    expect(projectId).toBe("project-1");
    expect(update.document.tracks[0].clips[0].asset_id).toBe("asset-1");

    expect(await screen.findByText("Added to a new Studio project.")).toBeTruthy();
    expect(JSON.parse(screen.getByTestId("location").textContent ?? "{}")).toEqual({
      pathname: "/studio/project-1",
      params: { projectId: "project-1" },
    });
  });

  it("opens an asset in the editor", async () => {
    apiSpy.assets.mockResolvedValue({ items: [makeAsset()], total: 1 });
    renderLibrary();
    await settleLibrary();

    fireEvent.click(screen.getByRole("button", { name: "Open in editor" }));

    expect(JSON.parse(screen.getByTestId("location").textContent ?? "{}")).toEqual({
      pathname: "/editor/asset-1",
      params: { assetId: "asset-1" },
    });
  });

  it("imports a file and opens its details", async () => {
    renderLibrary();
    await settleLibrary();

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["riff"], "take.wav", { type: "audio/wav" });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(apiSpy.importAsset).toHaveBeenCalledWith(file));
    expect(await screen.findByText("Audio imported.")).toBeTruthy();
    expect(screen.getByRole("dialog", { name: "Audio details" })).toBeTruthy();
    expect(screen.getByText("Imported take.wav")).toBeTruthy();
    await waitFor(() => expect(apiSpy.assets).toHaveBeenCalledTimes(2));
    expect(input.value).toBe("");
  });

  it("reports an import failure", async () => {
    apiSpy.importAsset.mockRejectedValue(networkError());
    renderLibrary();
    await settleLibrary();

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [new File(["riff"], "take.wav", { type: "audio/wav" })] },
    });

    expect(await screen.findByText("Could not reach the local Klyraudio service.")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows a load error and an empty result", async () => {
    apiSpy.assets.mockRejectedValue(networkError());
    renderLibrary();
    await settleLibrary();

    expect(screen.getByText("Could not reach the local Klyraudio service.")).toBeTruthy();
    expect(screen.getByText("Your library is empty")).toBeTruthy();
  });
});
