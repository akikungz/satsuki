import type { ProxyRouteRepository } from "../../application/ports";
import type { ProxyRoute } from "../../domain/proxy";
import type { PrismaClient } from "../../../prisma/generated/client";

export class PrismaProxyRouteRepository implements ProxyRouteRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findAll(): Promise<ProxyRoute[]> {
    const proxies = await this.prisma.instance_reverse_proxy.findMany({
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

    return proxies.flatMap((proxy) => {
      const vm = proxy.instance?.pve_vm;
      if (!vm?.hostname) {
        return [];
      }

      return [
        {
          type: proxy.type,
          targetPort: proxy.targetPort,
          hostname: vm.hostname,
          ipAddress: vm.pve_network_ip?.ipAddress || vm.hostname,
        },
      ];
    });
  }
}
