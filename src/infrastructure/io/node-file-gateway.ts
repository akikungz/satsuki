import { existsSync, mkdirSync, writeFileSync } from "fs";
import { dirname } from "path";
import type { ConfigFileGateway } from "../../application/ports";

export class NodeFileGateway implements ConfigFileGateway {
  exists(path: string): boolean {
    return existsSync(path);
  }

  ensureDirectoryFor(path: string): void {
    mkdirSync(dirname(path), { recursive: true });
  }

  write(path: string, content: string, mode?: number): void {
    const options = mode ? { encoding: "utf-8" as const, mode } : "utf-8";
    writeFileSync(path, content, options);
  }
}
