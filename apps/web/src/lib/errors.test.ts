import { describe, expect, it } from "vitest";
import { translate, type TranslateVars } from "../i18n";
import { ApiError } from "../api/client";
import { describeError, errorCode, truncate } from "./errors";

const t = (key: string, vars?: TranslateVars) => translate("en", key, vars);

function apiError(code: string, message = "backend detail") {
  return new ApiError({
    code,
    message,
    status: 400,
    remediation: "Check the file",
    requestId: "req-7",
  });
}

describe("describeError", () => {
  it("maps known API codes to translated messages", () => {
    const described = describeError(apiError("not_found", "raw backend text"), t);
    expect(described.message).toBe("The requested item was not found.");
    expect(described.code).toBe("not_found");
    expect(described.remediation).toBe("Check the file");
    expect(described.requestId).toBe("req-7");
    expect(described.offline).toBe(false);
  });

  it("falls back to the backend message when no translation exists", () => {
    const described = describeError(apiError("brand_new_code", "raw backend text"), t);
    expect(described.code).toBe("brand_new_code");
    expect(described.message).toBe("raw backend text");
  });

  it("marks network errors as offline", () => {
    const described = describeError(apiError("network_error", "fetch failed"), t);
    expect(described.offline).toBe(true);
    expect(described.code).toBe("network_error");
  });

  it("wraps non-API errors with the unknown template", () => {
    const described = describeError(new Error("boom"), t);
    expect(described.code).toBe("unknown");
    expect(described.message).toBe("Unexpected error: boom");
    expect(described.offline).toBe(false);
  });

  it("stringifies values that are not errors", () => {
    const described = describeError("plain string", t);
    expect(described.code).toBe("unknown");
    expect(described.message).toBe("Unexpected error: plain string");
  });
});

describe("errorCode", () => {
  it("returns the API code for API errors", () => {
    expect(errorCode(apiError("export_failed"))).toBe("export_failed");
  });

  it("returns unknown for anything else", () => {
    expect(errorCode(new Error("x"))).toBe("unknown");
    expect(errorCode(null)).toBe("unknown");
    expect(errorCode(undefined)).toBe("unknown");
  });
});

describe("truncate", () => {
  it("keeps short values unchanged", () => {
    expect(truncate("short", 10)).toBe("short");
    expect(truncate("exactly10", 10)).toBe("exactly10");
  });

  it("cuts long values and adds an ellipsis", () => {
    expect(truncate("a very long value", 10)).toBe("a very lo…");
    expect(truncate("0123456789a", 5)).toBe("0123…");
  });

  it("handles lengths that would slice to nothing", () => {
    expect(truncate("abc", 1)).toBe("…");
    expect(truncate("abc", 0)).toBe("…");
  });
});
