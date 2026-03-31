import type { PrismaClient } from "../../../prisma/generated/client";
import type { TriggerInstaller } from "../../application/ports";

const PROXY_TRIGGER_TABLES = [
  "instance_reverse_proxy",
  "instance",
  "pve_vm",
  "pve_network_ip",
];

export class PrismaTriggerInstaller implements TriggerInstaller {
  constructor(private readonly prisma: PrismaClient) {}

  async installProxyUpdateTriggers(): Promise<void> {
    await this.prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION notify_proxy_update() RETURNS TRIGGER AS $$
      BEGIN
        PERFORM pg_notify('proxy_updates', '');
        RETURN NULL;
      END;
      $$ LANGUAGE plpgsql;
    `);

    for (const table of PROXY_TRIGGER_TABLES) {
      const triggerName = `${table}_proxy_update_trigger`;
      await this.prisma.$executeRawUnsafe(
        `DROP TRIGGER IF EXISTS ${triggerName} ON "${table}";`,
      );
      await this.prisma.$executeRawUnsafe(`
        CREATE TRIGGER ${triggerName}
        AFTER INSERT OR UPDATE OR DELETE ON "${table}"
        FOR EACH STATEMENT EXECUTE FUNCTION notify_proxy_update();
      `);
    }
  }

  async installSshKeyUpdateTriggers(): Promise<void> {
    await this.prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION notify_ssh_key_update() RETURNS TRIGGER AS $$
      BEGIN
        PERFORM pg_notify('ssh_key_updates', '');
        RETURN NULL;
      END;
      $$ LANGUAGE plpgsql;
    `);

    const table = "platform_ssh_key";
    const triggerName = `${table}_ssh_key_update_trigger`;

    await this.prisma.$executeRawUnsafe(
      `DROP TRIGGER IF EXISTS ${triggerName} ON "${table}";`,
    );
    await this.prisma.$executeRawUnsafe(`
      CREATE TRIGGER ${triggerName}
      AFTER INSERT OR UPDATE OR DELETE ON "${table}"
      FOR EACH STATEMENT EXECUTE FUNCTION notify_ssh_key_update();
    `);
  }
}
