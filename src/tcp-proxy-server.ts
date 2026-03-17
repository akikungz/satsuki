import net from "node:net";
import tls from "node:tls";

import { type RouteTarget } from "./proxy-types";
import { parseSniFromTlsClientHello } from "./sni-utils";

const MAX_HANDSHAKE_BYTES = 16 * 1024;
const CLIENT_TIMEOUT_MS = 30_000;
const UPSTREAM_CONNECT_TIMEOUT_MS = 5_000;

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

function pipeSockets(clientSocket: net.Socket, upstreamSocket: net.Socket): void {
  clientSocket.pipe(upstreamSocket);
  upstreamSocket.pipe(clientSocket);
}

async function connectToUpstreamTarget(route: RouteTarget): Promise<net.Socket> {
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

    upstreamSocket.setTimeout(UPSTREAM_CONNECT_TIMEOUT_MS);
    upstreamSocket.once("connect", onConnect);
    upstreamSocket.once("error", onError);
    upstreamSocket.once("timeout", onTimeout);
  });
}

async function connectToFirstAvailableUpstream(
  routes: RouteTarget[],
  serverName: string,
): Promise<{ socket: net.Socket; selectedRoute: RouteTarget }> {
  const failures: string[] = [];

  for (const route of routes) {
    try {
      const socket = await connectToUpstreamTarget(route);
      return { socket, selectedRoute: route };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
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
  if (!fallbackErrorPage || clientSocket.destroyed) {
    closeSocket(clientSocket);
    return;
  }

  const body = Buffer.from(fallbackErrorPage.html, "utf8");
  const headers = [
    `HTTP/1.1 ${fallbackErrorPage.statusCode} ${reasonPhrase(fallbackErrorPage.statusCode)}`,
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

function createPassthroughProxyServer(resolveRoute: ResolveRoute): net.Server {
  return net.createServer((clientSocket) => {
    const state: ClientSessionState = {
      clientSocket,
      handshakeChunks: [],
      handshakeBytes: 0,
    };

    clientSocket.setTimeout(CLIENT_TIMEOUT_MS);
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

        const { socket: upstreamSocket, selectedRoute } =
          await connectToFirstAvailableUpstream(routes, serverName);

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
): tls.Server {
  return tls.createServer(
    {
      cert: tlsCredentials.cert,
      key: tlsCredentials.key,
    },
    async (clientSocket) => {
      clientSocket.setTimeout(CLIENT_TIMEOUT_MS);
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

        const { socket: upstreamSocket, selectedRoute } =
          await connectToFirstAvailableUpstream(routes, serverName);
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
  if (options.tlsCredentials) {
    return createTlsTerminatingProxyServer(
      resolveRoute,
      options.tlsCredentials,
      options.fallbackErrorPage,
    );
  }

  return createPassthroughProxyServer(resolveRoute);
}