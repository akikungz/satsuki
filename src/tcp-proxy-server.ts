import net from "node:net";
import tls from "node:tls";

import { type RouteTarget } from "./proxy-types";
import { parseSniFromTlsClientHello } from "./sni-utils";

const MAX_HANDSHAKE_BYTES = 16 * 1024;
const DEFAULT_CLIENT_HANDSHAKE_TIMEOUT_MS = 120_000;
const DEFAULT_UPSTREAM_CONNECT_TIMEOUT_MS = 15_000;
const DEFAULT_NGINX_ERROR_HTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>502 Bad Gateway</title>
  <style>
    html { color-scheme: light dark; }
    body {
      width: 35em;
      margin: 6em auto;
      font-family: Tahoma, Verdana, Arial, sans-serif;
      line-height: 1.5;
    }
    h1 { margin-bottom: 0.25em; }
    p { margin-top: 0.25em; }
  </style>
</head>
<body>
  <h1>502 Bad Gateway</h1>
  <p>The proxy could not reach the upstream service.</p>
  <p>Please try again later.</p>
  <hr />
  <p><em>satsuki proxy</em></p>
</body>
</html>`;

export type ResolveRoute = (serverName: string) => Promise<RouteTarget[] | null>;

export type TlsCredentials = {
  cert: Buffer;
  key: Buffer;
};

export type FallbackErrorPage = {
  statusCode: number;
  html: string;
};

export type ProxyServerOptions = {
  tlsCredentials?: TlsCredentials;
  fallbackErrorPage?: FallbackErrorPage;
  clientHandshakeTimeoutMs?: number;
  upstreamConnectTimeoutMs?: number;
};

type ClientSessionState = {
  clientSocket: net.Socket;
  handshakeChunks: Buffer[];
  handshakeBytes: number;
};

function closeSocket(socket: net.Socket): void {
  if (!socket.destroyed) {
    socket.destroy();
  }
}

function openUpstream(route: RouteTarget): net.Socket {
  return net.connect(route.targetPort, route.targetHost);
}

function formatRoute(route: RouteTarget): string {
  return `${route.targetHost}:${route.targetPort}`;
}

function logSniTranslation(serverName: string, routes: RouteTarget[]): void {
  const translatedHosts = routes.map(formatRoute).join(", ");
  console.info(`[proxy] SNI ${serverName} translated to [${translatedHosts}]`);
}

function pipeSockets(clientSocket: net.Socket, upstreamSocket: net.Socket): void {
  clientSocket.setTimeout(0);
  upstreamSocket.setTimeout(0);
  clientSocket.setKeepAlive(true);
  upstreamSocket.setKeepAlive(true);

  clientSocket.pipe(upstreamSocket);
  upstreamSocket.pipe(clientSocket);
}

async function connectToUpstreamTarget(
  route: RouteTarget,
  upstreamConnectTimeoutMs: number,
): Promise<net.Socket> {
  return await new Promise<net.Socket>((resolve, reject) => {
    const upstreamSocket = openUpstream(route);
    let settled = false;

    const cleanup = () => {
      upstreamSocket.off("connect", onConnect);
      upstreamSocket.off("error", onError);
      upstreamSocket.off("timeout", onTimeout);
    };

    const onConnect = () => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      upstreamSocket.setTimeout(0);
      resolve(upstreamSocket);
    };

    const onError = (error: Error) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      closeSocket(upstreamSocket);
      reject(error);
    };

    const onTimeout = () => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      closeSocket(upstreamSocket);
      reject(new Error("Upstream connection timed out"));
    };

    upstreamSocket.setTimeout(upstreamConnectTimeoutMs);
    upstreamSocket.once("connect", onConnect);
    upstreamSocket.once("error", onError);
    upstreamSocket.once("timeout", onTimeout);
  });
}

async function connectToFirstAvailableUpstream(
  routes: RouteTarget[],
  serverName: string,
  upstreamConnectTimeoutMs: number,
): Promise<{ socket: net.Socket; selectedRoute: RouteTarget }> {
  const failures: string[] = [];

  for (const route of routes) {
    try {
      const socket = await connectToUpstreamTarget(route, upstreamConnectTimeoutMs);
      return { socket, selectedRoute: route };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(
        `[proxy] Upstream candidate failed for ${serverName}: ${formatRoute(route)} (${reason})`,
      );
      failures.push(`${route.targetHost}:${route.targetPort} (${reason})`);
    }
  }

  throw new Error(
    `[proxy] No upstream endpoints reachable for ${serverName}. Tried: ${failures.join(", ")}`,
  );
}

function reasonPhrase(statusCode: number): string {
  switch (statusCode) {
    case 400:
      return "Bad Request";
    case 403:
      return "Forbidden";
    case 404:
      return "Not Found";
    case 502:
      return "Bad Gateway";
    case 503:
      return "Service Unavailable";
    case 504:
      return "Gateway Timeout";
    default:
      return "Error";
  }
}

function sendFallbackErrorPage(
  clientSocket: net.Socket,
  fallbackErrorPage: FallbackErrorPage | undefined,
): void {
  if (clientSocket.destroyed) {
    return;
  }

  const fallback = fallbackErrorPage ?? {
    statusCode: 502,
    html: DEFAULT_NGINX_ERROR_HTML,
  };

  const body = Buffer.from(fallback.html, "utf8");
  const headers = [
    `HTTP/1.1 ${fallback.statusCode} ${reasonPhrase(fallback.statusCode)}`,
    "Content-Type: text/html; charset=utf-8",
    `Content-Length: ${body.byteLength}`,
    "Connection: close",
    "",
    "",
  ].join("\r\n");

  clientSocket.end(Buffer.concat([Buffer.from(headers, "utf8"), body]));
}

function wireSocketBridge(clientSocket: net.Socket, upstreamSocket: net.Socket): void {
  pipeSockets(clientSocket, upstreamSocket);
}

function wireUpstreamErrorHandlers(
  upstreamSocket: net.Socket,
  clientSocket: net.Socket,
  serverName: string,
  route: RouteTarget,
): void {
  upstreamSocket.on("error", (error) => {
    console.error(
      `[proxy] Upstream error for ${serverName} -> ${route.targetHost}:${route.targetPort}:`,
      error.message,
    );
    closeSocket(clientSocket);
  });

  upstreamSocket.on("close", () => {
    if (!clientSocket.destroyed) {
      clientSocket.end();
    }
  });
}

function createPassthroughProxyServer(
  resolveRoute: ResolveRoute,
  clientHandshakeTimeoutMs: number,
  upstreamConnectTimeoutMs: number,
): net.Server {
  return net.createServer((clientSocket) => {
    const state: ClientSessionState = {
      clientSocket,
      handshakeChunks: [],
      handshakeBytes: 0,
    };

    clientSocket.setTimeout(clientHandshakeTimeoutMs);
    clientSocket.on("timeout", () => closeSocket(clientSocket));
    clientSocket.on("error", (error) => {
      console.error("[proxy] Client socket error:", error.message);
      closeSocket(clientSocket);
    });

    const onHandshakeData = async (chunk: Buffer) => {
      state.handshakeChunks.push(chunk);
      state.handshakeBytes += chunk.length;

      if (state.handshakeBytes > MAX_HANDSHAKE_BYTES) {
        console.warn("[proxy] TLS handshake exceeded max inspection size.");
        closeSocket(clientSocket);
        return;
      }

      const bufferedHandshake = Buffer.concat(state.handshakeChunks);
      const serverName = parseSniFromTlsClientHello(bufferedHandshake);
      if (!serverName) {
        return;
      }

      clientSocket.off("data", onHandshakeData);

      try {
        const routes = await resolveRoute(serverName);
        if (!routes || routes.length === 0) {
          console.warn(`[proxy] No route found for SNI ${serverName}`);
          closeSocket(clientSocket);
          return;
        }

        logSniTranslation(serverName, routes);

        const { socket: upstreamSocket, selectedRoute } =
          await connectToFirstAvailableUpstream(
            routes,
            serverName,
            upstreamConnectTimeoutMs,
          );

        console.info(
          `[proxy] SNI ${serverName} selected upstream ${formatRoute(selectedRoute)}`,
        );

        upstreamSocket.write(bufferedHandshake);
        pipeSockets(clientSocket, upstreamSocket);

        wireUpstreamErrorHandlers(
          upstreamSocket,
          clientSocket,
          serverName,
          selectedRoute,
        );
      } catch (error) {
        console.error("[proxy] Route resolution failed:", error);
        closeSocket(clientSocket);
      }
    };

    clientSocket.on("data", onHandshakeData);
  });
}

function createTlsTerminatingProxyServer(
  resolveRoute: ResolveRoute,
  tlsCredentials: TlsCredentials,
  fallbackErrorPage: FallbackErrorPage | undefined,
  clientHandshakeTimeoutMs: number,
  upstreamConnectTimeoutMs: number,
): tls.Server {
  return tls.createServer(
    {
      cert: tlsCredentials.cert,
      key: tlsCredentials.key,
    },
    async (clientSocket) => {
      clientSocket.setTimeout(clientHandshakeTimeoutMs);
      clientSocket.on("timeout", () => closeSocket(clientSocket));
      clientSocket.on("error", (error) => {
        console.error("[proxy] Client TLS socket error:", error.message);
        closeSocket(clientSocket);
      });

      const rawServerName = clientSocket.servername;
      const serverName =
        typeof rawServerName === "string" ? rawServerName.toLowerCase() : undefined;

      if (!serverName) {
        console.warn("[proxy] TLS client did not provide SNI.");
        sendFallbackErrorPage(clientSocket, fallbackErrorPage);
        return;
      }

      try {
        const routes = await resolveRoute(serverName);
        if (!routes || routes.length === 0) {
          console.warn(`[proxy] No route found for SNI ${serverName}`);
          sendFallbackErrorPage(clientSocket, fallbackErrorPage);
          return;
        }

        logSniTranslation(serverName, routes);

        const { socket: upstreamSocket, selectedRoute } =
          await connectToFirstAvailableUpstream(
            routes,
            serverName,
            upstreamConnectTimeoutMs,
          );

        console.info(
          `[proxy] SNI ${serverName} selected upstream ${formatRoute(selectedRoute)}`,
        );

        wireSocketBridge(clientSocket, upstreamSocket);

        upstreamSocket.on("error", (error) => {
          console.error(
            `[proxy] Upstream error for ${serverName} -> ${selectedRoute.targetHost}:${selectedRoute.targetPort}:`,
            error.message,
          );
          closeSocket(clientSocket);
        });

        upstreamSocket.on("close", () => {
          if (!clientSocket.destroyed) {
            clientSocket.end();
          }
        });
      } catch (error) {
        console.error("[proxy] Route resolution failed:", error);
        sendFallbackErrorPage(clientSocket, fallbackErrorPage);
      }
    },
  );
}

export function createProxyServer(
  resolveRoute: ResolveRoute,
  options: ProxyServerOptions = {},
): net.Server {
  const clientHandshakeTimeoutMs =
    options.clientHandshakeTimeoutMs ?? DEFAULT_CLIENT_HANDSHAKE_TIMEOUT_MS;
  const upstreamConnectTimeoutMs =
    options.upstreamConnectTimeoutMs ?? DEFAULT_UPSTREAM_CONNECT_TIMEOUT_MS;

  if (options.tlsCredentials) {
    return createTlsTerminatingProxyServer(
      resolveRoute,
      options.tlsCredentials,
      options.fallbackErrorPage,
      clientHandshakeTimeoutMs,
      upstreamConnectTimeoutMs,
    );
  }

  return createPassthroughProxyServer(
    resolveRoute,
    clientHandshakeTimeoutMs,
    upstreamConnectTimeoutMs,
  );
}