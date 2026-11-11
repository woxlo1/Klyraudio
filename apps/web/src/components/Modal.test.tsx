import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nProvider } from "../i18n";
import { ConfirmDialog, Modal } from "./Modal";

function renderModal(props: Partial<Parameters<typeof Modal>[0]> = {}) {
  const onClose = vi.fn();
  const view = render(
    <I18nProvider initialLanguage="en">
      <Modal title="Export audio" description="Choose a format" onClose={onClose} {...props}>
        <input type="text" aria-label="File name" />
      </Modal>
    </I18nProvider>,
  );
  return { onClose, unmount: view.unmount };
}

describe("Modal", () => {
  it("renders a labelled dialog in a portal", () => {
    renderModal();
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    const title = screen.getByText("Export audio");
    expect(dialog.getAttribute("aria-labelledby")).toBe(title.id);
    expect(dialog.getAttribute("aria-describedby")).toBe(screen.getByText("Choose a format").id);
  });

  it("locks page scrolling while open", () => {
    expect(document.body.style.overflow).toBe("");
    const rendered = renderModal();
    expect(document.body.style.overflow).toBe("hidden");
    rendered.unmount();
    expect(document.body.style.overflow).toBe("");
  });

  it("moves focus into the dialog and restores it afterwards", async () => {
    const opener = document.createElement("button");
    opener.textContent = "Open dialog";
    document.body.appendChild(opener);
    opener.focus();
    expect(document.activeElement).toBe(opener);

    const rendered = renderModal();
    const input = screen.getByLabelText("File name");
    await waitFor(() => expect(document.activeElement).toBe(input));

    rendered.unmount();
    await waitFor(() => expect(document.activeElement).toBe(opener));
    opener.remove();
  });

  it("closes on Escape and through the close button", () => {
    const { onClose } = renderModal();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Close dialog" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("closes when the overlay itself is clicked", () => {
    const { onClose } = renderModal();
    const overlay = screen.getByRole("dialog").parentElement;
    fireEvent.mouseDown(overlay!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("stays open when it is not dismissible", () => {
    const { onClose } = renderModal({ dismissible: false });
    expect(screen.queryByRole("button", { name: "Close dialog" })).toBeNull();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("ConfirmDialog", () => {
  it("confirms and cancels through its buttons", () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(
      <I18nProvider initialLanguage="en">
        <ConfirmDialog
          title="Delete asset"
          message="This cannot be undone."
          onConfirm={onConfirm}
          onClose={onClose}
        />
      </I18nProvider>,
    );
    expect(screen.getByText("This cannot be undone.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("blocks both buttons while busy", () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(
      <I18nProvider initialLanguage="en">
        <ConfirmDialog
          title="Delete asset"
          message="Removing."
          busy
          onConfirm={onConfirm}
          onClose={onClose}
        />
      </I18nProvider>,
    );
    expect((screen.getByRole("button", { name: "Confirm" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
});
