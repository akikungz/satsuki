import { SatsukiApp } from "../application/services/satsuki-app";
import { createInstallTriggers } from "../application/use-cases/install-triggers";
import { createInitializeEmptyConfig } from "../application/use-cases/initialize-empty-config";
import { createRefreshAuthorizedKeys } from "../application/use-cases/refresh-authorized-keys";
import { createRefreshProxyConfig } from "../application/use-cases/refresh-proxy-config";
import { loadAppConfig } from "../infrastructure/config/app-config";
import { NodeFileGateway } from "../infrastructure/io/node-file-gateway";
import { ConsoleLogger } from "../infrastructure/logging/console-logger";
import { PostgresNotificationSubscriber } from "../infrastructure/postgres/postgres-notification-subscriber";
import { createPrismaClient } from "../infrastructure/prisma/create-prisma-client";
import { PrismaProxyRouteRepository } from "../infrastructure/prisma/prisma-proxy-route-repository";
import { PrismaSshKeyRepository } from "../infrastructure/prisma/prisma-ssh-key-repository";
import { PrismaTriggerInstaller } from "../infrastructure/prisma/prisma-trigger-installer";
import { ShellCommandRunner } from "../infrastructure/system/shell-command-runner";
import { SystemClock } from "../infrastructure/time/system-clock";

export function createApp() {
  const config = loadAppConfig(process.env);
  const logger = new ConsoleLogger();
  const clock = new SystemClock();
  const fileGateway = new NodeFileGateway();
  const commandRunner = new ShellCommandRunner();
  const prisma = createPrismaClient(config.connectionString);
  const notificationSubscriber = new PostgresNotificationSubscriber(
    config.connectionString,
  );

  const refreshProxyConfig = createRefreshProxyConfig({
    proxyRouteRepository: new PrismaProxyRouteRepository(prisma),
    fileGateway,
    commandRunner,
    clock,
    logger,
    proxyDomainSuffix: config.proxyDomainSuffix,
    tlsCertPath: config.tlsCertPath,
    tlsKeyPath: config.tlsKeyPath,
    nginxStreamConfPath: config.nginxStreamConfPath,
    nginxHttpConfPath: config.nginxHttpConfPath,
    nginxReloadCommand: config.nginxReloadCommand,
  });

  const refreshAuthorizedKeys = createRefreshAuthorizedKeys({
    sshKeyRepository: new PrismaSshKeyRepository(prisma),
    fileGateway,
    clock,
    logger,
    bastionAuthorizedKeysPath: config.bastionAuthorizedKeysPath,
  });

  const initializeEmptyConfig = createInitializeEmptyConfig({
    fileGateway,
    clock,
    logger,
    nginxStreamConfPath: config.nginxStreamConfPath,
    nginxHttpConfPath: config.nginxHttpConfPath,
  });

  const installTriggers = createInstallTriggers(
    new PrismaTriggerInstaller(prisma),
    logger,
  );

  const app = new SatsukiApp({
    initializeEmptyConfig,
    installTriggers,
    refreshProxyConfig,
    refreshAuthorizedKeys,
    notificationSubscriber,
    logger,
    onShutdown: async () => {
      await prisma.$disconnect();
    },
  });

  return { app };
}
