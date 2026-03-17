# satsuki

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run index.ts
```

This project was created using `bun init` in bun v1.3.6. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.

## TCP reverse proxy (SNI-based)

`index.ts` runs a TCP/TLS passthrough reverse proxy that routes by SNI hostname template:

- `p{port_number}-{instance_hostname}.fitm.cloud`
- Example: `p8443-vm-01.fitm.cloud`

Route resolution flow:

1. Parse SNI from the TLS ClientHello packet.
2. Match the host against `p{port}-{instanceHostname}.{domainSuffix}`.
3. Resolve route from Redis cache (if available).
4. On cache miss, query Prisma (`instance_reverse_proxy` + `instance.pve_vm.hostname`).
5. Forward raw TCP to upstream VM host/IP and target port.

### Environment variables

- `DATABASE_URL` — PostgreSQL connection string for Prisma.
- `REDIS_URL` — Redis connection string for route caching.
- `PROXY_LISTEN_HOST` — bind host (default: `0.0.0.0`).
- `PROXY_LISTEN_PORT` — bind port (default: `443`).
- `PROXY_DOMAIN_SUFFIX` — allowed domain suffix (default: `fitm.cloud`).
- `ROUTE_CACHE_TTL_SECONDS` — Redis TTL for route cache (default: `60`).
