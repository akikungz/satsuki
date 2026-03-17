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
5. Build multiple upstream candidates (VM IP first, hostname fallback).
6. Forward to the first reachable upstream target port.

### TLS certificate support

The proxy supports two listener modes:

- **TLS passthrough mode (default):** no cert/key configured; proxy inspects ClientHello SNI and forwards raw TLS.
- **TLS termination mode:** set both `TLS_CERT_PATH` and `TLS_KEY_PATH`; proxy terminates inbound TLS and forwards decrypted TCP to upstream.

### Nginx error HTML fallback

When TLS termination mode is enabled, you can configure a static Nginx-style error page for route/upstream failures.

- Set `NGINX_ERROR_HTML_PATH` to a local HTML file path.
- Optionally set `NGINX_ERROR_STATUS` (default: `502`).

If not configured, the proxy keeps the previous behavior and closes failed client connections.

> Note: in TLS passthrough mode the proxy cannot safely inject HTTP content into encrypted streams, so fallback HTML is only applied in TLS termination mode.

### Environment variables

- `DATABASE_URL` — PostgreSQL connection string for Prisma.
- `REDIS_URL` — Redis connection string for route caching.
- `PROXY_LISTEN_HOST` — bind host (default: `0.0.0.0`).
- `PROXY_LISTEN_PORT` — bind port (default: `443`).
- `PROXY_DOMAIN_SUFFIX` — allowed domain suffix (default: `fitm.cloud`).
- `ROUTE_CACHE_TTL_SECONDS` — Redis TTL for route cache (default: `60`).
- `TLS_CERT_PATH` — path to TLS certificate PEM file (optional; requires `TLS_KEY_PATH`).
- `TLS_KEY_PATH` — path to TLS private key PEM file (optional; requires `TLS_CERT_PATH`).
- `NGINX_ERROR_HTML_PATH` — path to fallback HTML page (optional; TLS termination mode only).
- `NGINX_ERROR_STATUS` — HTTP status for fallback response (default: `502`).
