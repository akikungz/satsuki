import net from "node:net";

import { type RouteTarget } from "./proxy-types";
import { parseSniFromTlsClientHello } from "./sni-utils";

const MAX_HANDSHAKE_BYTES = 16 * 1024;
const CLIENT_TIMEOUT_MS = 30_000;

export type ResolveRoute = (serverName: string) => Promise<RouteTarget | null>;

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

export function createProxyServer(resolveRoute: ResolveRoute): net.Server {
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
        const route = await resolveRoute(serverName);
        if (!route) {
          console.warn(`[proxy] No route found for SNI ${serverName}`);
          closeSocket(clientSocket);
          return;
        }

        const upstreamSocket = openUpstream(route);

        upstreamSocket.once("connect", () => {
          upstreamSocket.write(bufferedHandshake);
          clientSocket.pipe(upstreamSocket);
          upstreamSocket.pipe(clientSocket);
        });

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
      } catch (error) {
        console.error("[proxy] Route resolution failed:", error);
        closeSocket(clientSocket);
      }
    };

    clientSocket.on("data", onHandshakeData);
  });
}