import { buildAuthorizedKeys } from "../../domain/services/build-authorized-keys";
import type {
  Clock,
  ConfigFileGateway,
  Logger,
  SshKeyRepository,
} from "../ports";

export interface RefreshAuthorizedKeysDependencies {
  sshKeyRepository: SshKeyRepository;
  fileGateway: ConfigFileGateway;
  clock: Clock;
  logger: Logger;
  bastionAuthorizedKeysPath: string;
}

export function createRefreshAuthorizedKeys(
  dependencies: RefreshAuthorizedKeysDependencies,
) {
  return async function refreshAuthorizedKeys(): Promise<void> {
    try {
      dependencies.logger.info("Generating authorized_keys for bastion user...");

      const keys = await dependencies.sshKeyRepository.findAll();
      const authorizedKeys = buildAuthorizedKeys(keys, {
        generatedAt: dependencies.clock.now(),
      });

      dependencies.fileGateway.ensureDirectoryFor(
        dependencies.bastionAuthorizedKeysPath,
      );
      dependencies.fileGateway.write(
        dependencies.bastionAuthorizedKeysPath,
        authorizedKeys.content,
        0o600,
      );

      dependencies.logger.info(
        `Successfully generated ${authorizedKeys.uniqueKeyCount} unique SSH keys to ${dependencies.bastionAuthorizedKeysPath}`,
      );
    } catch (error) {
      dependencies.logger.error("Error generating SSH keys:", error);
    }
  };
}
