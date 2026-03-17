import { type RedisClientType } from "redis";

import { type PrismaClient } from "../prisma/generated/client";
import { type RouteTarget } from "./proxy-types";
import { isPositiveInteger, parseSniTemplateHost, routeCacheKey } from "./sni-utils";

export type RouteResolverDependencies = {
  prisma: PrismaClient;
  redis: RedisClientType | null;
  routePattern: RegExp;
  routeCacheTtlSeconds: number;
};

function isRouteTarget(value: unknown): value is RouteTarget {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<RouteTarget>;
  return (
    typeof candidate.targetHost === "string" &&
    candidate.targetHost.length > 0 &&
    isPositiveInteger(candidate.targetPort ?? Number.NaN)
  );
}

function normalizeRouteTargets(value: unknown): RouteTarget[] {
  if (Array.isArray(value)) {
    return value.filter(isRouteTarget);
  }

  if (isRouteTarget(value)) {
    return [value];
  }

  return [];
}

function dedupeRouteTargets(targets: RouteTarget[]): RouteTarget[] {
  const seen = new Set<string>();

  return targets.filter((target) => {
    const key = `${target.targetHost.toLowerCase()}:${target.targetPort}`;
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

export function createRouteResolver({
  prisma,
  redis,
  routePattern,
  routeCacheTtlSeconds,
}: RouteResolverDependencies): (serverName: string) => Promise<RouteTarget[] | null> {
  async function getCachedRoute(serverName: string): Promise<RouteTarget[] | null> {
    if (!redis?.isOpen) {
      return null;
    }

    const raw = await redis.get(routeCacheKey(serverName));
    if (!raw) {
      return null;
    }

    try {
      const parsed = normalizeRouteTargets(JSON.parse(raw));
      const deduped = dedupeRouteTargets(parsed);
      if (deduped.length > 0) {
        return deduped;
      }
    } catch {
      return null;
    }

    return null;
  }

  async function setCachedRoute(serverName: string, routes: RouteTarget[]): Promise<void> {
    if (!redis?.isOpen) {
      return;
    }

    await redis.set(routeCacheKey(serverName), JSON.stringify(routes), {
      EX: routeCacheTtlSeconds,
    });
  }

  async function resolveRouteFromDatabase(serverName: string): Promise<RouteTarget[] | null> {
    const parsed = parseSniTemplateHost(serverName, routePattern);
    if (!parsed) {
      return null;
    }

    const reverseProxy = await prisma.instance_reverse_proxy.findFirst({
      where: {
        targetPort: parsed.port,
        instance: {
          pve_vm: {
            hostname: parsed.instanceHostname,
          },
        },
      },
      include: {
        instance: {
          include: {
            pve_vm: {
              include: {
                pve_network_ip: true,
              },
            },
          },
        },
      },
    });

    const vm = reverseProxy?.instance.pve_vm;
    if (!vm) {
      return null;
    }

    const targetPort = reverseProxy.targetPort;
    const targets: RouteTarget[] = [];

    if (vm.pve_network_ip?.ipAddress) {
      targets.push({
        targetHost: vm.pve_network_ip.ipAddress,
        targetPort,
      });
    }

    if (vm.hostname) {
      targets.push({
        targetHost: vm.hostname,
        targetPort,
      });
    }

    const deduped = dedupeRouteTargets(targets);
    return deduped.length > 0 ? deduped : null;
  }

  return async function resolveRoute(serverName: string): Promise<RouteTarget[] | null> {
    const cached = await getCachedRoute(serverName);
    if (cached) {
      return cached;
    }

    const routes = await resolveRouteFromDatabase(serverName);
    if (!routes) {
      return null;
    }

    await setCachedRoute(serverName, routes);
    return routes;
  };
}