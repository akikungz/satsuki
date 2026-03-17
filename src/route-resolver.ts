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

export function createRouteResolver({
  prisma,
  redis,
  routePattern,
  routeCacheTtlSeconds,
}: RouteResolverDependencies): (serverName: string) => Promise<RouteTarget | null> {
  async function getCachedRoute(serverName: string): Promise<RouteTarget | null> {
    if (!redis?.isOpen) {
      return null;
    }

    const raw = await redis.get(routeCacheKey(serverName));
    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as RouteTarget;
      if (
        typeof parsed.targetHost === "string" &&
        isPositiveInteger(parsed.targetPort) &&
        parsed.targetHost.length > 0
      ) {
        return parsed;
      }
    } catch {
      return null;
    }

    return null;
  }

  async function setCachedRoute(serverName: string, route: RouteTarget): Promise<void> {
    if (!redis?.isOpen) {
      return;
    }

    await redis.set(routeCacheKey(serverName), JSON.stringify(route), {
      EX: routeCacheTtlSeconds,
    });
  }

  async function resolveRouteFromDatabase(serverName: string): Promise<RouteTarget | null> {
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

    return {
      targetHost: vm.pve_network_ip?.ipAddress ?? vm.hostname,
      targetPort: reverseProxy.targetPort,
    };
  }

  return async function resolveRoute(serverName: string): Promise<RouteTarget | null> {
    const cached = await getCachedRoute(serverName);
    if (cached) {
      return cached;
    }

    const route = await resolveRouteFromDatabase(serverName);
    if (!route) {
      return null;
    }

    await setCachedRoute(serverName, route);
    return route;
  };
}