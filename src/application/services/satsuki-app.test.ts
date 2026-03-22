import { describe, expect, it, mock } from "bun:test";
import { SatsukiApp } from "./satsuki-app";
import type { Logger, NotificationSubscriber } from "../ports";

function createLogger(): Logger {
  return {
    info: mock(() => undefined),
    error: mock(() => undefined),
  };
}

describe("SatsukiApp", () => {
  it("runs startup flow and wires notification handlers", async () => {
    const handlers = new Map<string, () => Promise<void>>();
    const notificationSubscriber: NotificationSubscriber = {
      connect: mock(async () => undefined),
      listen: mock(async (channel: string, handler: () => Promise<void>) => {
        handlers.set(channel, handler);
      }),
      close: mock(async () => undefined),
    };

    const initializeEmptyConfig = mock(async () => undefined);
    const installTriggers = mock(async () => undefined);
    const refreshProxyConfig = mock(async () => undefined);
    const refreshAuthorizedKeys = mock(async () => undefined);
    const onShutdown = mock(async () => undefined);

    const app = new SatsukiApp({
      initializeEmptyConfig,
      installTriggers,
      refreshProxyConfig,
      refreshAuthorizedKeys,
      notificationSubscriber,
      onShutdown,
      logger: createLogger(),
    });

    await app.start();

    expect(initializeEmptyConfig).toHaveBeenCalledTimes(1);
    expect(installTriggers).toHaveBeenCalledTimes(1);
    expect(refreshProxyConfig).toHaveBeenCalledTimes(1);
    expect(refreshAuthorizedKeys).toHaveBeenCalledTimes(1);
    expect(notificationSubscriber.connect).toHaveBeenCalledTimes(1);
    expect(notificationSubscriber.listen).toHaveBeenCalledTimes(2);

    await handlers.get("proxy_updates")?.();
    await handlers.get("ssh_key_updates")?.();

    expect(refreshProxyConfig).toHaveBeenCalledTimes(2);
    expect(refreshAuthorizedKeys).toHaveBeenCalledTimes(2);

    await app.stop();

    expect(notificationSubscriber.close).toHaveBeenCalledTimes(1);
    expect(onShutdown).toHaveBeenCalledTimes(1);
  });
});
