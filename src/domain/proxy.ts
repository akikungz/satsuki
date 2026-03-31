export type ProxyType = "HTTP" | "HTTPS" | "TCP";

export interface ProxyRoute {
  type: ProxyType;
  targetPort: number;
  hostname: string;
  ipAddress?: string | null;
}

export interface ProxyConfigOptions {
  proxyDomainSuffix: string;
  tlsCertPath: string;
  tlsKeyPath: string;
  generatedAt: Date;
}

export interface ProxyConfigArtifacts {
  streamConfig: string;
  httpConfig: string;
  validStreamRoutesCount: number;
  validHttpRoutesCount: number;
}
