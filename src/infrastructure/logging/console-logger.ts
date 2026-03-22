import type { Logger } from "../../application/ports";

export class ConsoleLogger implements Logger {
  info(message: string): void {
    console.log(message);
  }

  error(message: string, error?: unknown): void {
    console.error(message, error);
  }
}
