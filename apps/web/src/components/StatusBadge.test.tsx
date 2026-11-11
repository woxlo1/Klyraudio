import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { JobStatus } from "../api/types";
import { I18nProvider } from "../i18n";
import { JobStatusBadge } from "./StatusBadge";

const TONES: Record<JobStatus, string> = {
  completed: "badge--success",
  failed: "badge--danger",
  running: "badge--accent",
  cancelled: "badge--warning",
  queued: "badge--neutral",
};

describe("JobStatusBadge", () => {
  it.each(Object.entries(TONES) as Array<[JobStatus, string]>)(
    "labels and colors the %s status",
    (status, tone) => {
      render(
        <I18nProvider initialLanguage="en">
          <JobStatusBadge status={status} />
        </I18nProvider>,
      );
      const badge = screen.getByText(status.charAt(0).toUpperCase() + status.slice(1));
      expect(badge.className).toContain("badge");
      expect(badge.className).toContain(tone);
    },
  );

  it("translates the status label in Japanese", () => {
    render(
      <I18nProvider initialLanguage="ja">
        <JobStatusBadge status="completed" />
      </I18nProvider>,
    );
    expect(screen.getByText("完了")).toBeTruthy();
  });
});
