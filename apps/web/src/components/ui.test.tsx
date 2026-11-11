import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Badge, Button, IconButton, ProgressBar, Segmented, Switch } from "./ui";

describe("Button", () => {
  it("renders its label and defaults to a plain button type", () => {
    render(<Button>Save project</Button>);
    const button = screen.getByRole("button", { name: "Save project" });
    expect(button.getAttribute("type")).toBe("button");
  });

  it("applies variant and size classes", () => {
    render(
      <Button variant="primary" size="sm">
        Go
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Go" });
    expect(button.className).toContain("btn--primary");
    expect(button.className).toContain("btn--sm");
  });

  it("disables the button while loading", () => {
    render(<Button loading>Working</Button>);
    const button = screen.getByRole("button", { name: /working/i });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it("forwards click events when enabled", () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Click</Button>);
    fireEvent.click(screen.getByRole("button", { name: "Click" }));
    expect(onClick).toHaveBeenCalledOnce();
  });
});

describe("IconButton", () => {
  it("exposes its label to assistive technology", () => {
    render(<IconButton label="Close dialog">x</IconButton>);
    const button = screen.getByRole("button", { name: "Close dialog" });
    expect(button.getAttribute("title")).toBe("Close dialog");
    expect(button.className).toContain("icon-button");
  });

  it("marks the active state", () => {
    const first = render(<IconButton label="Favorite">x</IconButton>);
    expect(screen.getByRole("button", { name: "Favorite" }).className).not.toContain("is-active");
    first.unmount();
    render(
      <IconButton label="Favorite" active>
        x
      </IconButton>,
    );
    expect(screen.getByRole("button", { name: "Favorite" }).className).toContain("is-active");
  });
});

describe("Switch", () => {
  it("exposes its checked state on the switch role", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <Switch checked={false} onChange={onChange} label="Show waveform" />,
    );
    const control = screen.getByRole("switch", { name: "Show waveform" });
    expect(control.getAttribute("aria-checked")).toBe("false");

    rerender(<Switch checked onChange={onChange} label="Show waveform" />);
    expect(control.getAttribute("aria-checked")).toBe("true");
  });

  it("toggles through the change callback", () => {
    const onChange = vi.fn();
    render(<Switch checked onChange={onChange} label="Show waveform" />);
    fireEvent.click(screen.getByRole("switch", { name: "Show waveform" }));
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it("ignores clicks while disabled", () => {
    const onChange = vi.fn();
    render(
      <Switch
        checked
        disabled
        onChange={onChange}
        label="Show waveform"
        description="Needs a restart"
      />,
    );
    const control = screen.getByRole("switch", { name: "Show waveform" });
    expect((control as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(control);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText("Needs a restart")).toBeTruthy();
  });
});

describe("Segmented", () => {
  it("renders every option and marks the selected one", () => {
    const onChange = vi.fn();
    render(
      <Segmented
        label="View"
        value="grid"
        onChange={onChange}
        options={[
          { value: "grid", label: "Grid" },
          { value: "list", label: "List" },
        ]}
      />,
    );
    const group = screen.getByRole("group", { name: "View" });
    expect(group.getAttribute("aria-label")).toBe("View");
    const grid = screen.getByRole("button", { name: "Grid" });
    const list = screen.getByRole("button", { name: "List" });
    expect(grid.getAttribute("aria-pressed")).toBe("true");
    expect(grid.className).toContain("is-active");
    expect(list.getAttribute("aria-pressed")).toBe("false");
  });

  it("reports a different option through the callback", () => {
    const onChange = vi.fn();
    render(
      <Segmented
        value="grid"
        onChange={onChange}
        options={[
          { value: "grid", label: "Grid" },
          { value: "list", label: "List" },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "List" }));
    expect(onChange).toHaveBeenCalledWith("list");
  });
});

describe("ProgressBar", () => {
  it("reports the rounded percentage for a determinate value", () => {
    render(<ProgressBar value={0.456} label="Rendering" />);
    const bar = screen.getByRole("progressbar");
    expect(bar.getAttribute("aria-valuemin")).toBe("0");
    expect(bar.getAttribute("aria-valuemax")).toBe("100");
    expect(bar.getAttribute("aria-valuenow")).toBe("46");
    expect(screen.getByText("Rendering")).toBeTruthy();
  });

  it("switches to an indeterminate presentation without a value", () => {
    render(<ProgressBar value={null} />);
    const bar = screen.getByRole("progressbar");
    expect(bar.className).toContain("is-indeterminate");
    expect(bar.getAttribute("aria-valuenow")).toBe(null);
  });

  it("clamps out-of-range values", () => {
    const { rerender } = render(<ProgressBar value={1.5} />);
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("100");
    rerender(<ProgressBar value={-2} />);
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("0");
  });
});

describe("Badge", () => {
  it("carries its tone class", () => {
    render(<Badge tone="success">Completed</Badge>);
    const badge = screen.getByText("Completed");
    expect(badge.className).toContain("badge--success");
  });
});
