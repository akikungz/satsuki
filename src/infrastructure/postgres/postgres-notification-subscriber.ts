import { Client } from "pg";
import type { NotificationSubscriber } from "../../application/ports";

export class PostgresNotificationSubscriber implements NotificationSubscriber {
  private readonly handlers = new Map<string, () => Promise<void>>();
  private readonly client: Client;

  constructor(connectionString: string) {
    this.client = new Client({ connectionString });
  }

  async connect(): Promise<void> {
    await this.client.connect();
    this.client.on("notification", async (message) => {
      const handler = this.handlers.get(message.channel);
      if (handler) {
        await handler();
      }
    });
  }

  async listen(channel: string, handler: () => Promise<void>): Promise<void> {
    this.handlers.set(channel, handler);
    await this.client.query(`LISTEN "${channel}"`);
  }

  async close(): Promise<void> {
    await this.client.end();
  }
}
