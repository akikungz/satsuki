import { describe, expect, test } from "bun:test";

import { parsePositiveIntegerEnv } from "./proxy-config";

describe("parsePositiveIntegerEnv", () => {
  test("uses parsed value when positive integer", () => {
    expect(parsePositiveIntegerEnv("443", 8443)).toBe(443);
  });

  test("returns fallback when missing", () => {
    expect(parsePositiveIntegerEnv(undefined, 443)).toBe(443);
  });

  test("returns fallback for zero and negative values", () => {
    expect(parsePositiveIntegerEnv("0", 443)).toBe(443);
    expect(parsePositiveIntegerEnv("-1", 443)).toBe(443);
  });

  test("returns fallback for non-numeric values", () => {
    expect(parsePositiveIntegerEnv("abc", 443)).toBe(443);
  });
});