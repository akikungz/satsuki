# satsuki

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run index.ts
```

To test:

```bash
bun test
```

This project was created using `bun init` in bun v1.3.6. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.

## Architecture

The app is organized into clean-architecture style layers:

- `src/domain`: pure business rules and renderers for Nginx config and `authorized_keys`
- `src/application`: use cases and port interfaces
- `src/infrastructure`: Prisma, filesystem, shell, time, logging, and Postgres LISTEN/NOTIFY adapters
- `src/bootstrap`: composition root that wires the app together

## Nginx Stream Config Generator

`index.ts` runs a background Bun service that automatically generates an Nginx TCP/SNI stream configuration mapping `p{port_number}-{instance_hostname}.{domain_suffix}` to upstream VM instances.

It connects to the PostgreSQL database directly, using `LISTEN` and `NOTIFY` over the `proxy_updates` channel to detect any changes to `instance_reverse_proxy` mapping or `instance` lifecycle events. Upon changes, it regenerates the Nginx `.conf` file and executes an Nginx reload command.

Route resolution block format:

- `p{port_number}-{instance_hostname}.fitm.cloud`
- Example: `p8443-vm-01.fitm.cloud`

Process flow:

1. Connects to PostgreSQL using Prisma and the generic `pg` client.
2. Checks and applies database `TRIGGER`s for related tables (`instance_reverse_proxy`, `instance`, `pve_vm`, `pve_network_ip`).
3. Whenever an insert, update, or delete occurs, Postgres fires the `notify_proxy_update()` trigger.
4. The service generates a complete Nginx stream file with `map $ssl_preread_server_name` and `upstream` blocks.
5. Saves the output file and optionally reloads Nginx dynamically.

### Environment variables

- `DATABASE_URL` — PostgreSQL connection string (must be direct connection to support LISTEN/NOTIFY, e.g. not a connection pooler like PgBouncer in transaction mode).
- `PROXY_DOMAIN_SUFFIX` — allowed domain suffix (default: `fitm.cloud`).
- `NGINX_CONF_PATH` — path to save generated stream conf (default: `./nginx/stream.conf`).
- `NGINX_RELOAD_COMMAND` — command executed to reload the web server when config updates (default: `nginx -s reload`).
