export type ParsedSniTemplate = {
  port: number;
  instanceHostname: string;
};

export function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

export function createRoutePattern(domainSuffix: string): RegExp {
  const escapedDomain = domainSuffix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^p(\\d+)-([a-z0-9-]+)\\.${escapedDomain}$`, "i");
}

export function parseSniTemplateHost(
  serverName: string,
  routePattern: RegExp,
): ParsedSniTemplate | null {
  const match = serverName.match(routePattern);
  if (!match) {
    return null;
  }

  const portText = match[1];
  const instanceHostname = match[2];

  if (!portText || !instanceHostname) {
    return null;
  }

  const port = Number.parseInt(portText, 10);
  if (!isPositiveInteger(port)) {
    return null;
  }

  return {
    port,
    instanceHostname: instanceHostname.toLowerCase(),
  };
}

export function routeCacheKey(serverName: string): string {
  return `sni-route:${serverName.toLowerCase()}`;
}

export function parseSniFromTlsClientHello(packet: Buffer): string | undefined {
  if (packet.length < 5) {
    return undefined;
  }

  const contentType = packet.readUInt8(0);
  if (contentType !== 22) {
    return undefined;
  }

  const tlsRecordLength = packet.readUInt16BE(3);
  const recordEnd = 5 + tlsRecordLength;

  if (packet.length < recordEnd) {
    return undefined;
  }

  let offset = 5;
  const handshakeType = packet.readUInt8(offset);
  if (handshakeType !== 1) {
    return undefined;
  }

  offset += 1;
  const handshakeLength = packet.readUIntBE(offset, 3);
  offset += 3;

  if (offset + handshakeLength > packet.length) {
    return undefined;
  }

  if (offset + 2 + 32 > packet.length) {
    return undefined;
  }

  offset += 2;
  offset += 32;

  if (offset + 1 > packet.length) {
    return undefined;
  }

  const sessionIdLength = packet.readUInt8(offset);
  offset += 1 + sessionIdLength;

  if (offset + 2 > packet.length) {
    return undefined;
  }

  const cipherSuitesLength = packet.readUInt16BE(offset);
  offset += 2 + cipherSuitesLength;

  if (offset + 1 > packet.length) {
    return undefined;
  }

  const compressionMethodsLength = packet.readUInt8(offset);
  offset += 1 + compressionMethodsLength;

  if (offset + 2 > packet.length) {
    return undefined;
  }

  const extensionsLength = packet.readUInt16BE(offset);
  offset += 2;
  const extensionsEnd = offset + extensionsLength;

  if (extensionsEnd > packet.length) {
    return undefined;
  }

  while (offset + 4 <= extensionsEnd) {
    const extensionType = packet.readUInt16BE(offset);
    offset += 2;
    const extensionLength = packet.readUInt16BE(offset);
    offset += 2;

    if (offset + extensionLength > extensionsEnd) {
      return undefined;
    }

    if (extensionType === 0) {
      let sniOffset = offset;
      if (sniOffset + 2 > offset + extensionLength) {
        return undefined;
      }

      const sniListLength = packet.readUInt16BE(sniOffset);
      sniOffset += 2;
      const sniListEnd = sniOffset + sniListLength;

      if (sniListEnd > offset + extensionLength) {
        return undefined;
      }

      while (sniOffset + 3 <= sniListEnd) {
        const nameType = packet.readUInt8(sniOffset);
        sniOffset += 1;
        const serverNameLength = packet.readUInt16BE(sniOffset);
        sniOffset += 2;

        if (sniOffset + serverNameLength > sniListEnd) {
          return undefined;
        }

        if (nameType === 0) {
          return packet
            .subarray(sniOffset, sniOffset + serverNameLength)
            .toString("utf8")
            .toLowerCase();
        }

        sniOffset += serverNameLength;
      }
    }

    offset += extensionLength;
  }

  return undefined;
}
