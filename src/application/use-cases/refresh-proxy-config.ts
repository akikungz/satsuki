import { buildProxyConfigs } from "../../domain/services/build-proxy-configs";
import type {
  Clock,
  CommandRunner,
  ConfigFileGateway,
  Logger,
  ProxyRouteRepository,
} from "../ports";

export interface RefreshProxyConfigDependencies {
  proxyRouteRepository: ProxyRouteRepository;
  fileGateway: ConfigFileGateway;
  commandRunner: CommandRunner;
  clock: Clock;
  logger: Logger;
  proxyDomainSuffix: string;
  tlsCertPath: string;
  tlsKeyPath: string;
  nginxStreamConfPath: string;
  nginxHttpConfPath: string;
  nginxReloadCommand?: string;
}

export function createRefreshProxyConfig(
  dependencies: RefreshProxyConfigDependencies,
) {
  return async function refreshProxyConfig(): Promise<void> {
    try {
      dependencies.logger.info("Generating Nginx stream configuration...");

      const routes = await dependencies.proxyRouteRepository.findAll();
      const artifacts = buildProxyConfigs(routes, {
        proxyDomainSuffix: dependencies.proxyDomainSuffix,
        tlsCertPath: dependencies.tlsCertPath,
        tlsKeyPath: dependencies.tlsKeyPath,
        generatedAt: dependencies.clock.now(),
      });

      dependencies.fileGateway.ensureDirectoryFor(
        dependencies.nginxStreamConfPath,
      );
      dependencies.fileGateway.ensureDirectoryFor(dependencies.nginxHttpConfPath);
      dependencies.fileGateway.write(
        dependencies.nginxStreamConfPath,
        artifacts.streamConfig,
      );
      dependencies.fileGateway.write(
        dependencies.nginxHttpConfPath,
        artifacts.httpConfig,
      );

      dependencies.logger.info(
        `Successfully generated ${artifacts.validStreamRoutesCount} stream routes to ${dependencies.nginxStreamConfPath}`,
      );
      dependencies.logger.info(
        `Successfully generated ${artifacts.validHttpRoutesCount} http routes to ${dependencies.nginxHttpConfPath}`,
      );

      if (!dependencies.nginxReloadCommand) {
        return;
      }

      dependencies.logger.info(
        `Reloading nginx using command: ${dependencies.nginxReloadCommand}`,
      );

      try {
        await dependencies.commandRunner.run(dependencies.nginxReloadCommand);
        dependencies.logger.info("Nginx reloaded successfully.");
      } catch (error) {
        dependencies.logger.error("Failed to reload Nginx.", error);
      }
    } catch (error) {
      dependencies.logger.error("Error generating config:", error);
    }
  };
}
