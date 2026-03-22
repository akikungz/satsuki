import { buildEmptyProxyConfigs } from "../../domain/services/build-proxy-configs";
import type { Clock, ConfigFileGateway, Logger } from "../ports";

export interface InitializeEmptyConfigDependencies {
  fileGateway: ConfigFileGateway;
  clock: Clock;
  logger: Logger;
  nginxStreamConfPath: string;
  nginxHttpConfPath: string;
}

export function createInitializeEmptyConfig(
  dependencies: InitializeEmptyConfigDependencies,
) {
  return async function initializeEmptyConfig(): Promise<void> {
    const needsStreamConfig = !dependencies.fileGateway.exists(
      dependencies.nginxStreamConfPath,
    );
    const needsHttpConfig = !dependencies.fileGateway.exists(
      dependencies.nginxHttpConfPath,
    );

    if (!needsStreamConfig && !needsHttpConfig) {
      return;
    }

    const emptyConfigs = buildEmptyProxyConfigs(dependencies.clock.now());

    if (needsStreamConfig) {
      dependencies.logger.info(
        `Stream config file not found at ${dependencies.nginxStreamConfPath}. Instantiating empty config...`,
      );
      dependencies.fileGateway.ensureDirectoryFor(
        dependencies.nginxStreamConfPath,
      );
      dependencies.fileGateway.write(
        dependencies.nginxStreamConfPath,
        emptyConfigs.streamConfig,
      );
    }

    if (needsHttpConfig) {
      dependencies.logger.info(
        `HTTP config file not found at ${dependencies.nginxHttpConfPath}. Instantiating empty config...`,
      );
      dependencies.fileGateway.ensureDirectoryFor(dependencies.nginxHttpConfPath);
      dependencies.fileGateway.write(
        dependencies.nginxHttpConfPath,
        emptyConfigs.httpConfig,
      );
    }
  };
}
