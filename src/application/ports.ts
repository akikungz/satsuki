import type { ProxyRoute } from "../domain/proxy";
import type { SshKeyRecord } from "../domain/ssh-keys";

export interface Logger {
  info(message: string): void;
  error(message: string, error?: unknown): void;
}

export interface Clock {
  now(): Date;
}

export interface ProxyRouteRepository {
  findAll(): Promise<ProxyRoute[]>;
}

export interface SshKeyRepository {
  findAll(): Promise<SshKeyRecord[]>;
}

export interface TriggerInstaller {
  installProxyUpdateTriggers(): Promise<void>;
  installSshKeyUpdateTriggers(): Promise<void>;
}

export interface ConfigFileGateway {
  exists(path: string): boolean;
  ensureDirectoryFor(path: string): void;
  write(path: string, content: string, mode?: number): void;
}

export interface CommandRunner {
  run(command: string): Promise<void>;
}

export interface NotificationSubscriber {
  connect(): Promise<void>;
  listen(channel: string, handler: () => Promise<void>): Promise<void>;
  close(): Promise<void>;
}
