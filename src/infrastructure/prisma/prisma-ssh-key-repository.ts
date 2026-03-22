import type { PrismaClient } from "../../../prisma/generated/client";
import type { SshKeyRepository } from "../../application/ports";

export class PrismaSshKeyRepository implements SshKeyRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findAll() {
    const keys = await this.prisma.platform_ssh_key.findMany();
    return keys.map((key) => ({ publicKey: key.publicKey }));
  }
}
