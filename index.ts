import process from "node:process";

import { PrismaPg } from "@prisma/adapter-pg";
import { createClient, type RedisClientType } from "redis";

import { PrismaClient } from "./prisma/generated/client";
import { loadProxyConfig } from "./src/proxy-config";
import { createRouteResolver } from "./src/route-resolver";
import { createRoutePattern, isPositiveInteger } from "./src/sni-utils";
import { createProxyServer } from "./src/tcp-proxy-server";

const config = loadProxyConfig();

const prismaAdapter = new PrismaPg({ connectionString: config.databaseUrl });
const prisma = new PrismaClient({ adapter: prismaAdapter });

let redis: RedisClientType | null = null;

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

  const server = createProxyServer(resolveRoute);

  server.on("error", (error) => {
    console.error("[proxy] Server error:", error);
    process.exitCode = 1;
  });

  server.listen(config.listenPort, config.listenHost, () => {
    console.info(
      `[proxy] Listening on ${config.listenHost}:${config.listenPort} for *.${config.domainSuffix} SNI routes`,
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
