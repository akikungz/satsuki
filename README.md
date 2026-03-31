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
- `NGINX_STREAM_CONF_PATH` — path to save generated stream conf (default: `./nginx/satsuki-stream.conf`).
- `NGINX_HTTP_CONF_PATH` — path to save generated HTTP conf (default: `./nginx/satsuki-http.conf`).
- `NGINX_RELOAD_COMMAND` — command executed to reload the web server when config updates (default: `nginx -s reload`).
- `TLS_CERT_PATH` — TLS certificate path used in generated config.
- `TLS_KEY_PATH` — TLS private key path used in generated config.
- `BASTION_AUTHORIZED_KEYS_PATH` — output path for generated `authorized_keys`.

## systemd

A sample unit file is included at `deploy/satsuki.service`.

Example installation on Linux:

```bash
sudo mkdir -p /opt/satsuki /etc/satsuki
sudo cp -R . /opt/satsuki
sudo cp deploy/satsuki.service /etc/systemd/system/satsuki.service
sudo cp .env /etc/satsuki/satsuki.env
sudo systemctl daemon-reload
sudo systemctl enable --now satsuki
```

Then check the service:

```bash
sudo systemctl status satsuki
sudo journalctl -u satsuki -f
```

Adjust these values to match your server before enabling it:

- `User` and `Group` in `deploy/satsuki.service` if you want to run without `root`
- `WorkingDirectory` in `deploy/satsuki.service`
- `EnvironmentFile` in `deploy/satsuki.service`
- The `bun` binary path if it is not available in the service `PATH`

The sample uses `root` because this service may need permission to write Nginx config files, update `authorized_keys`, and run the Nginx reload command. If you want to run it as a dedicated service user instead, make sure that user has access to all configured output paths and reload commands first.
