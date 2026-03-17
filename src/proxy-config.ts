import process from "node:process";

import { isPositiveInteger } from "./sni-utils";

const DEFAULT_DOMAIN_SUFFIX = "fitm.cloud";
const DEFAULT_LISTEN_HOST = "0.0.0.0";
const DEFAULT_LISTEN_PORT = 443;
const DEFAULT_ROUTE_CACHE_TTL_SECONDS = 60;
const DEFAULT_CLIENT_HANDSHAKE_TIMEOUT_MS = 120_000;
const DEFAULT_UPSTREAM_CONNECT_TIMEOUT_MS = 15_000;

export type ProxyConfig = {
  databaseUrl: string;
  redisUrl: string | undefined;
  domainSuffix: string;
  listenHost: string;
  listenPort: number;
  routeCacheTtlSeconds: number;
  tlsCertPath: string | undefined;
  tlsKeyPath: string | undefined;
  nginxErrorHtmlPath: string | undefined;
  nginxErrorStatus: number;
  clientHandshakeTimeoutMs: number;
  upstreamConnectTimeoutMs: number;
};

export function parsePositiveIntegerEnv(
  value: string | undefined,
  fallback: number,
): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (isPositiveInteger(parsed)) {
    return parsed;
  }

  return fallback;
}

export function parseNonNegativeIntegerEnv(
  value: string | undefined,
  fallback: number,
): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (Number.isInteger(parsed) && parsed >= 0) {
    return parsed;
  }

  return fallback;
}

export function loadProxyConfig(): ProxyConfig {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  const tlsCertPath = process.env.TLS_CERT_PATH;
  const tlsKeyPath = process.env.TLS_KEY_PATH;

  if ((tlsCertPath && !tlsKeyPath) || (!tlsCertPath && tlsKeyPath)) {
    throw new Error("TLS_CERT_PATH and TLS_KEY_PATH must be set together");
  }

  return {
    databaseUrl,
    redisUrl: process.env.REDIS_URL,
    domainSuffix: (process.env.PROXY_DOMAIN_SUFFIX ?? DEFAULT_DOMAIN_SUFFIX).toLowerCase(),
    listenHost: process.env.PROXY_LISTEN_HOST ?? DEFAULT_LISTEN_HOST,
    listenPort: parsePositiveIntegerEnv(
      process.env.PROXY_LISTEN_PORT,
      DEFAULT_LISTEN_PORT,
    ),
    routeCacheTtlSeconds: parsePositiveIntegerEnv(
      process.env.ROUTE_CACHE_TTL_SECONDS,
      DEFAULT_ROUTE_CACHE_TTL_SECONDS,
    ),
    tlsCertPath,
    tlsKeyPath,
    nginxErrorHtmlPath: process.env.NGINX_ERROR_HTML_PATH,
    nginxErrorStatus: parsePositiveIntegerEnv(process.env.NGINX_ERROR_STATUS, 502),
    clientHandshakeTimeoutMs: parseNonNegativeIntegerEnv(
      process.env.PROXY_CLIENT_HANDSHAKE_TIMEOUT_MS,
      DEFAULT_CLIENT_HANDSHAKE_TIMEOUT_MS,
    ),
    upstreamConnectTimeoutMs: parseNonNegativeIntegerEnv(
      process.env.PROXY_UPSTREAM_CONNECT_TIMEOUT_MS,
      DEFAULT_UPSTREAM_CONNECT_TIMEOUT_MS,
    ),
  };
}