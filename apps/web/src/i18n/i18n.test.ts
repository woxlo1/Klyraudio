import { describe, expect, it } from "vitest";
import { en } from "./en";
import { ja } from "./ja";

type FlatEntry = { path: string; value: unknown };

function flatten(value: unknown, prefix: string, out: FlatEntry[]): void {
  if (value === null || typeof value !== "object") {
    out.push({ path: prefix, value });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => flatten(item, `${prefix}[${index}]`, out));
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    flatten(child, prefix ? `${prefix}.${key}` : key, out);
  }
}

function flattenMessages(tree: unknown): FlatEntry[] {
  const entries: FlatEntry[] = [];
  flatten(tree, "", entries);
  return entries;
}

function placeholders(template: string): string[] {
  return Array.from(template.matchAll(/\{(\w+)\}/g), (match) => match[1]).sort();
}

describe("translations", () => {
  const english = flattenMessages(en);
  const japanese = flattenMessages(ja);

  it("keeps the Japanese tree in sync with English", () => {
    const englishPaths = english.map((entry) => entry.path).sort();
    const japanesePaths = japanese.map((entry) => entry.path).sort();
    expect(japanesePaths).toEqual(englishPaths);
  });

  it("has no empty translated values", () => {
    for (const entry of japanese) {
      expect(entry.value, `${entry.path} should be a string`).toEqual(expect.any(String));
      expect((entry.value as string).trim(), `${entry.path} should not be empty`).not.toBe("");
    }
  });

  it("uses the same interpolation placeholders as English", () => {
    const englishByPath = new Map(english.map((entry) => [entry.path, entry.value]));
    for (const entry of japanese) {
      const englishValue = englishByPath.get(entry.path);
      expect(typeof englishValue, `${entry.path} should exist in English`).toBe("string");
      expect(placeholders(entry.value as string), `${entry.path} placeholders`).toEqual(
        placeholders(englishValue as string),
      );
    }
  });
});
