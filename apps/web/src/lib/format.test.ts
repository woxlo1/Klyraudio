import { describe, expect, it } from "vitest";
import {
  classNames,
  clamp,
  downloadFileName,
  formatBytes,
  formatDuration,
  formatMemoryMb,
  formatMemoryPct,
  formatPercent,
  formatSampleRate,
  isEditableTarget,
  panLabel,
  signedDb,
  uid,
} from "./format";

describe("classNames", () => {
  it("joins truthy values and skips the rest", () => {
    expect(classNames("a", false, undefined, null, "b")).toBe("a b");
  });

  it("returns an empty string without usable values", () => {
    expect(classNames(false, null, undefined)).toBe("");
  });
});

describe("clamp", () => {
  it("keeps values inside the range", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-3, 0, 10)).toBe(0);
    expect(clamp(14, 0, 10)).toBe(10);
  });

  it("prefers the minimum bound when the range is inverted", () => {
    expect(clamp(3, 10, 0)).toBe(0);
  });
});

describe("uid", () => {
  it("prefixes every generated id", () => {
    expect(uid("asset").startsWith("asset_")).toBe(true);
    expect(uid("toast").startsWith("toast_")).toBe(true);
  });

  it("generates distinct ids for repeated calls", () => {
    const ids = new Set(Array.from({ length: 50 }, () => uid("job")));
    expect(ids.size).toBe(50);
  });
});

describe("formatDuration", () => {
  it("returns an em dash for missing or non-finite values", () => {
    expect(formatDuration(null)).toBe("—");
    expect(formatDuration(undefined)).toBe("—");
    expect(formatDuration(Number.NaN)).toBe("—");
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe("—");
  });

  it("clamps negative input to zero", () => {
    expect(formatDuration(-12)).toBe("0:00");
  });

  it("formats whole seconds under a minute", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(59)).toBe("0:59");
  });

  it("shows tenths only for short, fractional durations", () => {
    expect(formatDuration(12.34)).toBe("0:12.3");
    expect(formatDuration(59.94)).toBe("0:59.9");
    expect(formatDuration(60.4)).toBe("1:00");
  });

  it("rolls over to minutes and hours", () => {
    expect(formatDuration(75)).toBe("1:15");
    expect(formatDuration(600)).toBe("10:00");
    expect(formatDuration(3675.5)).toBe("1:01:15");
    expect(formatDuration(3600)).toBe("1:00:00");
  });
});

describe("formatBytes", () => {
  it("returns an em dash for missing or non-finite values", () => {
    expect(formatBytes(null)).toBe("—");
    expect(formatBytes(undefined)).toBe("—");
    expect(formatBytes(Number.NaN)).toBe("—");
  });

  it("renders byte values below one kibibyte", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1023)).toBe("1023 B");
  });

  it("picks the largest fitting unit", () => {
    expect(formatBytes(1024)).toBe("1.00 KB");
    expect(formatBytes(1536)).toBe("1.50 KB");
    expect(formatBytes(1024 * 1024)).toBe("1.00 MB");
    expect(formatBytes(1024 ** 4)).toBe("1.00 TB");
  });

  it("drops precision as the number grows", () => {
    expect(formatBytes(10 * 1024 ** 2)).toBe("10.0 MB");
    expect(formatBytes(100 * 1024 ** 2)).toBe("100 MB");
    expect(formatBytes(3 * 1024 ** 4)).toBe("3.00 TB");
  });

  it("caps at the terabyte unit", () => {
    expect(formatBytes(1024 ** 5)).toBe("1024 TB");
  });
});

describe("formatMemoryMb", () => {
  it("returns an em dash for missing values", () => {
    expect(formatMemoryMb(null)).toBe("—");
    expect(formatMemoryMb(undefined)).toBe("—");
  });

  it("renders megabytes below one gibibyte", () => {
    expect(formatMemoryMb(0)).toBe("0 MB");
    expect(formatMemoryMb(512)).toBe("512 MB");
    expect(formatMemoryMb(1023)).toBe("1023 MB");
  });

  it("converts to gigabytes", () => {
    expect(formatMemoryMb(2048)).toBe("2.0 GB");
    expect(formatMemoryMb(5120)).toBe("5.0 GB");
    expect(formatMemoryMb(20480)).toBe("20 GB");
  });
});

describe("formatSampleRate", () => {
  it("returns an em dash for missing or zero rates", () => {
    expect(formatSampleRate(null)).toBe("—");
    expect(formatSampleRate(undefined)).toBe("—");
    expect(formatSampleRate(0)).toBe("—");
  });

  it("renders whole kilohertz without decimals", () => {
    expect(formatSampleRate(8000)).toBe("8 kHz");
    expect(formatSampleRate(48000)).toBe("48 kHz");
  });

  it("keeps one decimal for fractional kilohertz", () => {
    expect(formatSampleRate(44100)).toBe("44.1 kHz");
  });
});

describe("formatPercent", () => {
  it("returns an em dash for missing or non-finite values", () => {
    expect(formatPercent(null)).toBe("—");
    expect(formatPercent(undefined)).toBe("—");
    expect(formatPercent(Number.NaN)).toBe("—");
  });

  it("rounds ratios to whole percents", () => {
    expect(formatPercent(0)).toBe("0%");
    expect(formatPercent(0.5)).toBe("50%");
    expect(formatPercent(0.334)).toBe("33%");
  });

  it("clamps values outside the unit interval", () => {
    expect(formatPercent(-0.4)).toBe("0%");
    expect(formatPercent(1.7)).toBe("100%");
  });

  it("shares the clamping behaviour with formatMemoryPct", () => {
    expect(formatMemoryPct(0.25)).toBe("25%");
    expect(formatMemoryPct(1.2)).toBe("100%");
  });
});

describe("signedDb", () => {
  it("marks positive values with a plus sign", () => {
    expect(signedDb(2.5)).toBe("+2.5 dB");
    expect(signedDb(0.5)).toBe("+0.5 dB");
  });

  it("leaves zero and negative values unmarked", () => {
    expect(signedDb(0)).toBe("0.0 dB");
    expect(signedDb(-6)).toBe("-6.0 dB");
  });
});

describe("panLabel", () => {
  const labels = { left: "Left", center: "Center", right: "Right" };

  it("treats a narrow center band as centered", () => {
    expect(panLabel(0, labels)).toBe("Center");
    expect(panLabel(0.01, labels)).toBe("Center");
    expect(panLabel(-0.019, labels)).toBe("Center");
  });

  it("names the side and the amount", () => {
    expect(panLabel(-0.5, labels)).toBe("Left 50%");
    expect(panLabel(0.5, labels)).toBe("Right 50%");
    expect(panLabel(1, labels)).toBe("Right 100%");
    expect(panLabel(-1, labels)).toBe("Left 100%");
  });
});

describe("downloadFileName", () => {
  it("keeps names that already end with the extension", () => {
    expect(downloadFileName("clip.wav", "wav")).toBe("clip.wav");
  });

  it("appends the extension when it is missing", () => {
    expect(downloadFileName("clip", "wav")).toBe("clip.wav");
    expect(downloadFileName("clip.WAV", "wav")).toBe("clip.WAV");
  });

  it("strips characters that are unsafe in file names", () => {
    expect(downloadFileName('bad<>:"/\\|?*name', "flac")).toBe("badname.flac");
  });

  it("falls back to a generic stem for empty input", () => {
    expect(downloadFileName("   ", "wav")).toBe("audio.wav");
  });

  it("removes control characters", () => {
    expect(downloadFileName("line\nbreak\ttab", "wav")).toBe("linebreaktab.wav");
  });
});

describe("isEditableTarget", () => {
  it("recognizes editable elements", () => {
    expect(isEditableTarget(document.createElement("input"))).toBe(true);
    expect(isEditableTarget(document.createElement("textarea"))).toBe(true);
    expect(isEditableTarget(document.createElement("select"))).toBe(true);
    const editable = document.createElement("div");
    // jsdom does not implement contentEditable, so expose it explicitly.
    Object.defineProperty(editable, "isContentEditable", { value: true });
    expect(isEditableTarget(editable)).toBe(true);
  });

  it("rejects non-element targets and plain containers", () => {
    expect(isEditableTarget(null)).toBe(false);
    expect(isEditableTarget(document.createElement("div"))).toBeFalsy();
    expect(isEditableTarget(document.createElement("button"))).toBeFalsy();
  });
});
