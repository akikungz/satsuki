import process from "node:process";

import { isPositiveInteger } from "./sni-utils";

const DEFAULT_DOMAIN_SUFFIX = "fitm.cloud";
const DEFAULT_LISTEN_HOST = "0.0.0.0";
const DEFAULT_LISTEN_PORT = 443;
const DEFAULT_ROUTE_CACHE_TTL_SECONDS = 60;

export type ProxyConfig = {
  databaseUrl: string;
  redisUrl: string | undefined;
  domainSuffix: string;
  listenHost: string;
  listenPort: number;
  routeCacheTtlSeconds: number;
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

export function loadProxyConfig(): ProxyConfig {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
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
  };
}