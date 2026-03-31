import type { Logger, NotificationSubscriber } from "../ports";

export interface SatsukiAppDependencies {
  initializeEmptyConfig: () => Promise<void>;
  installTriggers: () => Promise<void>;
  refreshProxyConfig: () => Promise<void>;
  refreshAuthorizedKeys: () => Promise<void>;
  notificationSubscriber: NotificationSubscriber;
  onShutdown: () => Promise<void>;
  logger: Logger;
}

export class SatsukiApp {
  constructor(private readonly dependencies: SatsukiAppDependencies) {}

  async start(): Promise<void> {
    this.dependencies.logger.info(
      "Starting satsuki nginx stream config generator...",
    );

    await this.dependencies.initializeEmptyConfig();
    await this.dependencies.installTriggers();
    await this.dependencies.refreshProxyConfig();
    await this.dependencies.refreshAuthorizedKeys();

    await this.dependencies.notificationSubscriber.connect();
    this.dependencies.logger.info(
      "Connected to PostgreSQL for LISTEN notifications.",
    );

    await this.dependencies.notificationSubscriber.listen(
      "proxy_updates",
      async () => {
        this.dependencies.logger.info(
          "Received notification on proxy_updates channel. Regenerating config...",
        );
        await this.dependencies.refreshProxyConfig();
      },
    );

    await this.dependencies.notificationSubscriber.listen(
      "ssh_key_updates",
      async () => {
        this.dependencies.logger.info(
          "Received notification on ssh_key_updates channel. Regenerating SSH keys...",
        );
        await this.dependencies.refreshAuthorizedKeys();
      },
    );

    this.dependencies.logger.info(
      "Listening for proxy_updates and ssh_key_updates...",
    );
  }

  async stop(): Promise<void> {
    this.dependencies.logger.info("Shutting down...");
    await this.dependencies.notificationSubscriber.close();
    await this.dependencies.onShutdown();
  }
}
