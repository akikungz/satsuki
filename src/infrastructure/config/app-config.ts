export interface AppConfig {
  connectionString: string;
  proxyDomainSuffix: string;
  nginxStreamConfPath: string;
  nginxHttpConfPath: string;
  nginxReloadCommand?: string;
  tlsCertPath: string;
  tlsKeyPath: string;
  bastionAuthorizedKeysPath: string;
}

export function loadAppConfig(env: NodeJS.ProcessEnv): AppConfig {
  const connectionString = env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL must be defined");
  }

  return {
    connectionString,
    proxyDomainSuffix: env.PROXY_DOMAIN_SUFFIX || "fitm.cloud",
    nginxStreamConfPath:
      env.NGINX_STREAM_CONF_PATH || "./nginx/satsuki-stream.conf",
    nginxHttpConfPath: env.NGINX_HTTP_CONF_PATH || "./nginx/satsuki-http.conf",
    nginxReloadCommand: env.NGINX_RELOAD_COMMAND || "nginx -s reload",
    tlsCertPath: env.TLS_CERT_PATH || "/etc/nginx/ssl/fullchain.pem",
    tlsKeyPath: env.TLS_KEY_PATH || "/etc/nginx/ssl/privkey.pem",
    bastionAuthorizedKeysPath:
      env.BASTION_AUTHORIZED_KEYS_PATH || "./authorized_keys",
  };
}
