import type { Logger, TriggerInstaller } from "../ports";

export function createInstallTriggers(
  triggerInstaller: TriggerInstaller,
  logger: Logger,
) {
  return async function installTriggers(): Promise<void> {
    logger.info("Setting up database triggers...");
    await triggerInstaller.installProxyUpdateTriggers();
    logger.info("Database triggers setup complete.");

    logger.info("Setting up database triggers for SSH keys...");
    await triggerInstaller.installSshKeyUpdateTriggers();
    logger.info("Database triggers for SSH keys setup complete.");
  };
}
