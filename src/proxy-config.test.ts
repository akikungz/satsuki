import { describe, expect, test } from "bun:test";

import {
  loadProxyConfig,
  parseNonNegativeIntegerEnv,
  parsePositiveIntegerEnv,
} from "./proxy-config";

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

describe("parseNonNegativeIntegerEnv", () => {
  test("accepts 0 as disabled value", () => {
    expect(parseNonNegativeIntegerEnv("0", 120000)).toBe(0);
  });

  test("uses fallback for negative values", () => {
    expect(parseNonNegativeIntegerEnv("-1", 120000)).toBe(120000);
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

describe("loadProxyConfig timeout settings", () => {
  test("uses default timeout values when unset", () => {
    const previousDatabaseUrl = process.env.DATABASE_URL;
    const previousHandshakeTimeout = process.env.PROXY_CLIENT_HANDSHAKE_TIMEOUT_MS;
    const previousUpstreamTimeout = process.env.PROXY_UPSTREAM_CONNECT_TIMEOUT_MS;

    process.env.DATABASE_URL = "postgresql://example";
    delete process.env.PROXY_CLIENT_HANDSHAKE_TIMEOUT_MS;
    delete process.env.PROXY_UPSTREAM_CONNECT_TIMEOUT_MS;

    const config = loadProxyConfig();
    expect(config.clientHandshakeTimeoutMs).toBe(120000);
    expect(config.upstreamConnectTimeoutMs).toBe(15000);

    process.env.DATABASE_URL = previousDatabaseUrl;
    process.env.PROXY_CLIENT_HANDSHAKE_TIMEOUT_MS = previousHandshakeTimeout;
    process.env.PROXY_UPSTREAM_CONNECT_TIMEOUT_MS = previousUpstreamTimeout;
  });

  test("uses provided timeout overrides", () => {
    const previousDatabaseUrl = process.env.DATABASE_URL;
    const previousHandshakeTimeout = process.env.PROXY_CLIENT_HANDSHAKE_TIMEOUT_MS;
    const previousUpstreamTimeout = process.env.PROXY_UPSTREAM_CONNECT_TIMEOUT_MS;

    process.env.DATABASE_URL = "postgresql://example";
    process.env.PROXY_CLIENT_HANDSHAKE_TIMEOUT_MS = "90000";
    process.env.PROXY_UPSTREAM_CONNECT_TIMEOUT_MS = "20000";

    const config = loadProxyConfig();
    expect(config.clientHandshakeTimeoutMs).toBe(90000);
    expect(config.upstreamConnectTimeoutMs).toBe(20000);

    process.env.DATABASE_URL = previousDatabaseUrl;
    process.env.PROXY_CLIENT_HANDSHAKE_TIMEOUT_MS = previousHandshakeTimeout;
    process.env.PROXY_UPSTREAM_CONNECT_TIMEOUT_MS = previousUpstreamTimeout;
  });

  test("accepts timeout value 0 to disable timeouts", () => {
    const previousDatabaseUrl = process.env.DATABASE_URL;
    const previousHandshakeTimeout = process.env.PROXY_CLIENT_HANDSHAKE_TIMEOUT_MS;
    const previousUpstreamTimeout = process.env.PROXY_UPSTREAM_CONNECT_TIMEOUT_MS;

    process.env.DATABASE_URL = "postgresql://example";
    process.env.PROXY_CLIENT_HANDSHAKE_TIMEOUT_MS = "0";
    process.env.PROXY_UPSTREAM_CONNECT_TIMEOUT_MS = "0";

    const config = loadProxyConfig();
    expect(config.clientHandshakeTimeoutMs).toBe(0);
    expect(config.upstreamConnectTimeoutMs).toBe(0);

    process.env.DATABASE_URL = previousDatabaseUrl;
    process.env.PROXY_CLIENT_HANDSHAKE_TIMEOUT_MS = previousHandshakeTimeout;
    process.env.PROXY_UPSTREAM_CONNECT_TIMEOUT_MS = previousUpstreamTimeout;
  });
});