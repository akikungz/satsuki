import fs from "node:fs";
import process from "node:process";

import { PrismaPg } from "@prisma/adapter-pg";
import { createClient, type RedisClientType } from "redis";

import { PrismaClient } from "./prisma/generated/client";
import { loadProxyConfig } from "./src/proxy-config";
import { createRouteResolver } from "./src/route-resolver";
import { createRoutePattern, isPositiveInteger } from "./src/sni-utils";
import {
  createProxyServer,
  type FallbackErrorPage,
  type TlsCredentials,
} from "./src/tcp-proxy-server";

const config = loadProxyConfig();

const prismaAdapter = new PrismaPg({ connectionString: config.databaseUrl });
const prisma = new PrismaClient({ adapter: prismaAdapter });

let redis: RedisClientType | null = null;

function loadTlsCredentials(): TlsCredentials | undefined {
  if (!config.tlsCertPath || !config.tlsKeyPath) {
    return undefined;
  }

  return {
    cert: fs.readFileSync(config.tlsCertPath),
    key: fs.readFileSync(config.tlsKeyPath),
  };
}

function loadFallbackErrorPage(): FallbackErrorPage | undefined {
  if (!config.nginxErrorHtmlPath) {
    return undefined;
  }

  return {
    statusCode: config.nginxErrorStatus,
    html: fs.readFileSync(config.nginxErrorHtmlPath, "utf8"),
  };
}

async function initRedis(): Promise<void> {
  if (!config.redisUrl) {
    console.warn("[proxy] REDIS_URL is not set; route cache is disabled.");
    return;
  }

  redis = createClient({
    url: config.redisUrl,
  });

  redis.on("error", (error) => {
    console.error("[proxy] Redis error:", error);
  });

  await redis.connect();
  console.info("[proxy] Redis cache connected.");
}

async function start(): Promise<void> {
  if (!isPositiveInteger(config.listenPort)) {
    throw new Error(`Invalid PROXY_LISTEN_PORT: ${config.listenPort}`);
  }

  await initRedis();

  const resolveRoute = createRouteResolver({
    prisma,
    redis,
    routePattern: createRoutePattern(config.domainSuffix),
    routeCacheTtlSeconds: config.routeCacheTtlSeconds,
  });

  const tlsCredentials = loadTlsCredentials();
  const fallbackErrorPage = loadFallbackErrorPage();
  const server = createProxyServer(resolveRoute, {
    tlsCredentials,
    fallbackErrorPage,
    clientHandshakeTimeoutMs: config.clientHandshakeTimeoutMs,
    upstreamConnectTimeoutMs: config.upstreamConnectTimeoutMs,
  });

  server.on("error", (error) => {
    console.error("[proxy] Server error:", error);
    process.exitCode = 1;
  });

  server.listen(config.listenPort, config.listenHost, () => {
    console.info(
      `[proxy] Listening on ${config.listenHost}:${config.listenPort} for *.${config.domainSuffix} SNI routes`,
    );

    if (tlsCredentials) {
      console.info("[proxy] TLS termination enabled (certificate/key loaded).");
    } else {
      console.info("[proxy] TLS passthrough mode enabled.");
    }

    if (fallbackErrorPage) {
      console.info(
        `[proxy] Fallback error page enabled from ${config.nginxErrorHtmlPath} (status ${config.nginxErrorStatus}).`,
      );
    }

    console.info(
      `[proxy] Timeouts: handshake=${config.clientHandshakeTimeoutMs}ms, upstream-connect=${config.upstreamConnectTimeoutMs}ms`,
    );
  });

  const shutdown = async () => {
    console.info("[proxy] Shutting down...");

    server.close();
    await redis?.quit().catch(() => undefined);
    await prisma.$disconnect().catch(() => undefined);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

start().catch(async (error) => {
  console.error("[proxy] Failed to start:", error);
  await redis?.quit().catch(() => undefined);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
