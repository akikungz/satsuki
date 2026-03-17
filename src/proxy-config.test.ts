import { describe, expect, test } from "bun:test";

import { loadProxyConfig, parsePositiveIntegerEnv } from "./proxy-config";

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

describe("loadProxyConfig TLS settings", () => {
  test("throws when only TLS_CERT_PATH is set", () => {
    const previousDatabaseUrl = process.env.DATABASE_URL;
    const previousCertPath = process.env.TLS_CERT_PATH;
    const previousKeyPath = process.env.TLS_KEY_PATH;

    process.env.DATABASE_URL = "postgresql://example";
    process.env.TLS_CERT_PATH = "./certs/localhost.crt";
    delete process.env.TLS_KEY_PATH;

    expect(() => loadProxyConfig()).toThrow(
      "TLS_CERT_PATH and TLS_KEY_PATH must be set together",
    );

    process.env.DATABASE_URL = previousDatabaseUrl;
    process.env.TLS_CERT_PATH = previousCertPath;
    process.env.TLS_KEY_PATH = previousKeyPath;
  });

  test("throws when only TLS_KEY_PATH is set", () => {
    const previousDatabaseUrl = process.env.DATABASE_URL;
    const previousCertPath = process.env.TLS_CERT_PATH;
    const previousKeyPath = process.env.TLS_KEY_PATH;

    process.env.DATABASE_URL = "postgresql://example";
    delete process.env.TLS_CERT_PATH;
    process.env.TLS_KEY_PATH = "./certs/localhost.key";

    expect(() => loadProxyConfig()).toThrow(
      "TLS_CERT_PATH and TLS_KEY_PATH must be set together",
    );

    process.env.DATABASE_URL = previousDatabaseUrl;
    process.env.TLS_CERT_PATH = previousCertPath;
    process.env.TLS_KEY_PATH = previousKeyPath;
  });
});