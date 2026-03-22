import type {
  ProxyConfigArtifacts,
  ProxyConfigOptions,
  ProxyRoute,
} from "../proxy";

function sanitizeUpstreamSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9]/g, "_");
}

export function buildProxyConfigs(
  routes: ProxyRoute[],
  options: ProxyConfigOptions,
): ProxyConfigArtifacts {
  let streamMapBlock = "map $ssl_preread_server_name $sni_from_preread {\n";
  streamMapBlock += '    ""      $ssl_server_name;\n';
  streamMapBlock += "    default $ssl_preread_server_name;\n";
  streamMapBlock += "}\n\n";

  streamMapBlock += "map $sni_from_preread $proxy_upstream {\n";
  streamMapBlock += "    hostnames;\n";
  streamMapBlock += `    ${options.proxyDomainSuffix} backend_default;\n`;

  let streamUpstreamsBlock = "upstream backend_default {\n";
  streamUpstreamsBlock += "    server 127.0.0.1:443;\n";
  streamUpstreamsBlock += "}\n\n";

  let httpUpstreamsBlock = "\n";
  let httpServerBlocks = "\n";

  const streamUpstreams = new Set<string>();
  const httpUpstreams = new Set<string>();

  let validStreamRoutesCount = 0;
  let validHttpRoutesCount = 0;

  httpServerBlocks += "server {\n";
  httpServerBlocks += "    listen 80;\n";
  httpServerBlocks += `    server_name *.${options.proxyDomainSuffix};\n`;
  httpServerBlocks += "    location / {\n";
  httpServerBlocks += "        return 301 https://$host$request_uri;\n";
  httpServerBlocks += "    }\n";
  httpServerBlocks += "}\n";

  for (const route of routes) {
    if (!route.hostname) {
      continue;
    }

    const ipAddress = route.ipAddress || route.hostname;
    const hostnameInfo = `p${route.targetPort}-${route.hostname}.${options.proxyDomainSuffix}`;
    const upstreamName = `backend_p${route.targetPort}_${sanitizeUpstreamSegment(
      route.hostname,
    )}`;

    if (route.type === "HTTP" || route.type === "HTTPS") {
      httpServerBlocks += "server {\n";
      httpServerBlocks += "    listen 443 ssl;\n";
      httpServerBlocks += `    server_name ${hostnameInfo};\n`;
      httpServerBlocks += "    \n";
      httpServerBlocks += `    ssl_certificate ${options.tlsCertPath};\n`;
      httpServerBlocks += `    ssl_certificate_key ${options.tlsKeyPath};\n`;
      httpServerBlocks += "    \n";
      httpServerBlocks += "    location / {\n";
      httpServerBlocks += `        proxy_pass http://${upstreamName};\n`;
      httpServerBlocks += "        proxy_set_header Host $host;\n";
      httpServerBlocks += "        proxy_set_header X-Real-IP $remote_addr;\n";
      httpServerBlocks +=
        "        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n";
      httpServerBlocks += "        proxy_set_header X-Forwarded-Proto $scheme;\n";
      httpServerBlocks += "    }\n";
      httpServerBlocks += "}\n\n";

      if (!httpUpstreams.has(upstreamName)) {
        httpUpstreamsBlock += `upstream ${upstreamName} {\n`;
        httpUpstreamsBlock += `    server ${ipAddress}:${route.targetPort};\n`;
        httpUpstreamsBlock += "}\n\n";
        httpUpstreams.add(upstreamName);
      }

      validHttpRoutesCount += 1;
      continue;
    }

    if (route.type === "TCP") {
      if (!streamUpstreams.has(upstreamName)) {
        streamUpstreamsBlock += `upstream ${upstreamName} {\n`;
        streamUpstreamsBlock += `    server ${ipAddress}:${route.targetPort};\n`;
        streamUpstreamsBlock += "}\n\n";
        streamUpstreams.add(upstreamName);
      }

      streamMapBlock += `    ${hostnameInfo} ${upstreamName};\n`;
      validStreamRoutesCount += 1;
    }
  }

  streamMapBlock += "    default backend_default;\n";
  streamMapBlock += "}\n";

  const generatedAt = options.generatedAt.toISOString();
  const streamConfig = `# Auto-generated Nginx Stream Config - ${generatedAt}
# Generated based on ${validStreamRoutesCount} active reverse proxy routes

${streamMapBlock}
${streamUpstreamsBlock}
`;

  const httpConfig = `# Auto-generated Nginx HTTP Config - ${generatedAt}
# Generated based on ${validHttpRoutesCount} active reverse proxy routes

${httpUpstreamsBlock}
${httpServerBlocks}
`;

  return {
    streamConfig,
    httpConfig,
    validStreamRoutesCount,
    validHttpRoutesCount,
  };
}

export function buildEmptyProxyConfigs(generatedAt: Date): ProxyConfigArtifacts {
  const timestamp = generatedAt.toISOString();

  return {
    streamConfig: `# Auto-generated Nginx Stream Config - ${timestamp}
# Initialized empty block

map $ssl_preread_server_name $proxy_upstream {
    default backend_default;
}

upstream backend_default {
    server 127.0.0.1:65535; # Fake fallback port
}
`,
    httpConfig: `# Auto-generated Nginx HTTP Config - ${timestamp}
# Initialized empty block
`,
    validStreamRoutesCount: 0,
    validHttpRoutesCount: 0,
  };
}
