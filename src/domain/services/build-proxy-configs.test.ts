import { describe, expect, it } from "bun:test";
import { buildEmptyProxyConfigs, buildProxyConfigs } from "./build-proxy-configs";

describe("buildProxyConfigs", () => {
  it("renders HTTP and TCP routes with deduplicated upstreams", () => {
    const generatedAt = new Date("2026-03-22T00:00:00.000Z");

    const result = buildProxyConfigs(
      [
        {
          type: "HTTP",
          targetPort: 8080,
          hostname: "vm-01",
          ipAddress: "10.0.0.10",
        },
        {
          type: "HTTPS",
          targetPort: 8080,
          hostname: "vm-01",
          ipAddress: "10.0.0.10",
        },
        {
          type: "TCP",
          targetPort: 25565,
          hostname: "game-server",
          ipAddress: "10.0.0.20",
        },
      ],
      {
        proxyDomainSuffix: "example.com",
        tlsCertPath: "/tls/fullchain.pem",
        tlsKeyPath: "/tls/privkey.pem",
        generatedAt,
      },
    );

    expect(result.validHttpRoutesCount).toBe(2);
    expect(result.validStreamRoutesCount).toBe(1);
    expect(result.httpConfig).toContain(
      "server_name p8080-vm-01.example.com;",
    );
    expect(result.httpConfig).toContain(
      "upstream backend_p8080_vm_01 {\n    server 10.0.0.10:8080;\n}",
    );
    expect(result.httpConfig.match(/upstream backend_p8080_vm_01/g)?.length).toBe(
      1,
    );
    expect(result.streamConfig).toContain(
      "p25565-game-server.example.com backend_p25565_game_server;",
    );
    expect(result.streamConfig).toContain(
      "# Auto-generated Nginx Stream Config - 2026-03-22T00:00:00.000Z",
    );
  });

  it("falls back to hostname when ip address is not present", () => {
    const result = buildProxyConfigs(
      [
        {
          type: "TCP",
          targetPort: 5432,
          hostname: "db-primary",
          ipAddress: null,
        },
      ],
      {
        proxyDomainSuffix: "example.com",
        tlsCertPath: "/tls/fullchain.pem",
        tlsKeyPath: "/tls/privkey.pem",
        generatedAt: new Date("2026-03-22T00:00:00.000Z"),
      },
    );

    expect(result.streamConfig).toContain("server db-primary:5432;");
  });
});

describe("buildEmptyProxyConfigs", () => {
  it("creates placeholder configs", () => {
    const result = buildEmptyProxyConfigs(
      new Date("2026-03-22T00:00:00.000Z"),
    );

    expect(result.validHttpRoutesCount).toBe(0);
    expect(result.validStreamRoutesCount).toBe(0);
    expect(result.streamConfig).toContain("127.0.0.1:65535");
    expect(result.httpConfig).toContain("# Initialized empty block");
  });
});
