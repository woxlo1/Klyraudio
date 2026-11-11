import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { I18nProvider } from "../i18n";
import { ToastProvider, useToast, type ToastTone } from "./toast";

interface ToastSpec {
  message: string;
  title?: string;
  tone?: ToastTone;
  durationMs?: number;
}

function ToastHarness({ messages }: { messages: ToastSpec[] }) {
  const { notify } = useToast();
  return (
    <>
      <button
        type="button"
        onClick={() => {
          for (const message of messages) notify(message);
        }}
      >
        notify
      </button>
      <span>app content</span>
    </>
  );
}

function renderHarness(messages: ToastSpec[]) {
  render(
    <I18nProvider initialLanguage="en">
      <ToastProvider>
        <ToastHarness messages={messages} />
      </ToastProvider>
    </I18nProvider>,
  );
}

function renderDismissHarness() {
  function DismissHarness() {
    const { notify, dismiss } = useToast();
    const [lastId, setLastId] = useState("");
    return (
      <>
        <button
          type="button"
          onClick={() => {
            setLastId(notify({ message: "Temporary" }));
          }}
        >
          notify
        </button>
        <button type="button" onClick={() => dismiss(lastId)}>
          dismiss by id
        </button>
      </>
    );
  }
  render(
    <I18nProvider initialLanguage="en">
      <ToastProvider>
        <DismissHarness />
      </ToastProvider>
    </I18nProvider>,
  );
}

describe("ToastProvider", () => {
  it("renders notifications inside a polite live region", () => {
    renderHarness([{ title: "Export finished", message: "Saved to disk." }]);
    fireEvent.click(screen.getByRole("button", { name: "notify" }));
    const region = screen.getByLabelText("Notification");
    expect(region.getAttribute("aria-live")).toBe("polite");
    expect(screen.getByText("Export finished")).toBeTruthy();
    expect(screen.getByText("Saved to disk.")).toBeTruthy();
    expect(screen.getByText("app content")).toBeTruthy();
  });

  it("accepts a plain message with a tone", () => {
    renderHarness([{ message: "Waveform cached", tone: "success" }]);
    fireEvent.click(screen.getByRole("button", { name: "notify" }));
    expect(screen.getByRole("status").className).toContain("toast--success");
  });

  it("defaults to the info tone", () => {
    renderHarness([{ message: "Something happened" }]);
    fireEvent.click(screen.getByRole("button", { name: "notify" }));
    expect(screen.getByRole("status").className).toContain("toast--info");
  });

  it("dismisses a notification from its button", () => {
    renderHarness([{ message: "Temporary" }]);
    fireEvent.click(screen.getByRole("button", { name: "notify" }));
    expect(screen.getByText("Temporary")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText("Temporary")).toBeNull();
  });

  it("dismisses a notification by its returned id", () => {
    renderDismissHarness();
    fireEvent.click(screen.getByRole("button", { name: "notify" }));
    expect(screen.getByText("Temporary")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "dismiss by id" }));
    expect(screen.queryByText("Temporary")).toBeNull();
  });

  it("keeps at most five notifications on screen", () => {
    renderHarness(Array.from({ length: 6 }, (_, index) => ({ message: `Message ${index}` })));
    fireEvent.click(screen.getByRole("button", { name: "notify" }));
    expect(screen.getAllByRole("status")).toHaveLength(5);
    expect(screen.queryByText("Message 0")).toBeNull();
    expect(screen.getByText("Message 5")).toBeTruthy();
  });
});

describe("toast auto-dismissal", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("removes a notification after its duration", () => {
    renderHarness([{ message: "Brief", durationMs: 1500 }]);
    fireEvent.click(screen.getByRole("button", { name: "notify" }));
    expect(screen.getByText("Brief")).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(screen.queryByText("Brief")).toBeNull();
  });

  it("keeps error notifications longer than informational ones", () => {
    renderHarness([
      { message: "Boom", tone: "error" },
      { message: "Done", tone: "success" },
    ]);
    fireEvent.click(screen.getByRole("button", { name: "notify" }));
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.queryByText("Done")).toBeNull();
    expect(screen.getByText("Boom")).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(screen.queryByText("Boom")).toBeNull();
  });
});

describe("useToast", () => {
  it("rejects use outside the provider", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Outside />)).toThrow(/ToastProvider/);
    consoleError.mockRestore();
  });
});

function Outside() {
  useToast();
  return null;
}
