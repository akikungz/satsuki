import { describe, expect, test } from "bun:test";

import {
  createRoutePattern,
  parseHostFromHttpRequest,
  parseSniFromTlsClientHello,
  parseSniTemplateHost,
  routeCacheKey,
} from "./sni-utils";

function encodeUint24(value: number): Buffer {
  return Buffer.from([(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff]);
}

function buildClientHelloPacket(serverName?: string): Buffer {
  const protocolVersion = Buffer.from([0x03, 0x03]);
  const random = Buffer.alloc(32, 0);
  const sessionIdLength = Buffer.from([0x00]);
  const cipherSuites = Buffer.from([0x00, 0x02, 0x13, 0x01]);
  const compressionMethods = Buffer.from([0x01, 0x00]);

  const extensions: Buffer[] = [];

  if (serverName) {
    const host = Buffer.from(serverName, "utf8");
    const serverNameEntry = Buffer.concat([
      Buffer.from([0x00]),
      Buffer.from([(host.length >> 8) & 0xff, host.length & 0xff]),
      host,
    ]);
    const serverNameList = Buffer.concat([
      Buffer.from([
        (serverNameEntry.length >> 8) & 0xff,
        serverNameEntry.length & 0xff,
      ]),
      serverNameEntry,
    ]);

    const sniExtension = Buffer.concat([
      Buffer.from([0x00, 0x00]),
      Buffer.from([(serverNameList.length >> 8) & 0xff, serverNameList.length & 0xff]),
      serverNameList,
    ]);

    extensions.push(sniExtension);
  }

  const extensionsBlob = Buffer.concat(extensions);
  const extensionsLength = Buffer.from([
    (extensionsBlob.length >> 8) & 0xff,
    extensionsBlob.length & 0xff,
  ]);

  const clientHelloBody = Buffer.concat([
    protocolVersion,
    random,
    sessionIdLength,
    cipherSuites,
    compressionMethods,
    extensionsLength,
    extensionsBlob,
  ]);

  const handshake = Buffer.concat([
    Buffer.from([0x01]),
    encodeUint24(clientHelloBody.length),
    clientHelloBody,
  ]);

  const tlsRecordHeader = Buffer.from([
    0x16,
    0x03,
    0x01,
    (handshake.length >> 8) & 0xff,
    handshake.length & 0xff,
  ]);

  return Buffer.concat([tlsRecordHeader, handshake]);
}

describe("parseSniTemplateHost", () => {
  const pattern = createRoutePattern("fitm.cloud");

  test("parses valid SNI template host", () => {
    const result = parseSniTemplateHost("p8443-vm-01.fitm.cloud", pattern);
    expect(result).toEqual({ port: 8443, instanceHostname: "vm-01" });
  });

  test("normalizes hostname case", () => {
    const result = parseSniTemplateHost("p443-VM-ABC.fitm.cloud", pattern);
    expect(result).toEqual({ port: 443, instanceHostname: "vm-abc" });
  });

  test("rejects wrong domain", () => {
    const result = parseSniTemplateHost("p443-vm-01.example.com", pattern);
    expect(result).toBeNull();
  });

  test("rejects zero port", () => {
    const result = parseSniTemplateHost("p0-vm-01.fitm.cloud", pattern);
    expect(result).toBeNull();
  });

  test("rejects invalid hostname characters", () => {
    const result = parseSniTemplateHost("p443-vm_01.fitm.cloud", pattern);
    expect(result).toBeNull();
  });
});

describe("parseSniFromTlsClientHello", () => {
  test("extracts and lowercases SNI", () => {
    const packet = buildClientHelloPacket("P8443-VM-01.FITM.CLOUD");
    expect(parseSniFromTlsClientHello(packet)).toBe("p8443-vm-01.fitm.cloud");
  });

  test("returns undefined when packet is incomplete", () => {
    const packet = buildClientHelloPacket("p443-vm.fitm.cloud").subarray(0, 10);
    expect(parseSniFromTlsClientHello(packet)).toBeUndefined();
  });

  test("returns undefined for non-TLS handshake content type", () => {
    const packet = Buffer.from(buildClientHelloPacket("p443-vm.fitm.cloud"));
    packet[0] = 0x17;
    expect(parseSniFromTlsClientHello(packet)).toBeUndefined();
  });

  test("returns undefined when SNI extension is absent", () => {
    const packet = buildClientHelloPacket();
    expect(parseSniFromTlsClientHello(packet)).toBeUndefined();
  });
});

describe("routeCacheKey", () => {
  test("normalizes to lowercase", () => {
    expect(routeCacheKey("P443-VM.fitm.cloud")).toBe("sni-route:p443-vm.fitm.cloud");
  });
});

describe("parseHostFromHttpRequest", () => {
  test("extracts host from plain HTTP request", () => {
    const request = Buffer.from(
      "GET / HTTP/1.1\r\nHost: p7443-vm-01.fitm.cloud\r\nUser-Agent: test\r\n\r\n",
      "utf8",
    );

    expect(parseHostFromHttpRequest(request)).toEqual({
      state: "found",
      host: "p7443-vm-01.fitm.cloud",
    });
  });

  test("removes port suffix from host header", () => {
    const request = Buffer.from(
      "GET / HTTP/1.1\r\nHost: p7443-vm-01.fitm.cloud:8080\r\n\r\n",
      "utf8",
    );

    expect(parseHostFromHttpRequest(request)).toEqual({
      state: "found",
      host: "p7443-vm-01.fitm.cloud",
    });
  });

  test("returns pending for incomplete headers", () => {
    const request = Buffer.from("GET / HTTP/1.1\r\nHost: p7443-vm-01.fitm.cloud", "utf8");
    expect(parseHostFromHttpRequest(request)).toEqual({ state: "pending" });
  });

  test("returns invalid when host header is missing", () => {
    const request = Buffer.from("GET / HTTP/1.1\r\nUser-Agent: test\r\n\r\n", "utf8");
    expect(parseHostFromHttpRequest(request)).toEqual({ state: "invalid" });
  });

  test("returns not-http for non-http data", () => {
    const request = buildClientHelloPacket("p443-vm.fitm.cloud");
    expect(parseHostFromHttpRequest(request)).toEqual({ state: "not-http" });
  });
});
