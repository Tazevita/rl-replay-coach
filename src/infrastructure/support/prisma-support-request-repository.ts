import type { PrismaClient } from "@prisma/client";
import type { SupportRequestRepository } from "../../application/ports";

export class PrismaSupportRequestRepository implements SupportRequestRepository {
  constructor(private readonly client: PrismaClient) {}

  async create(record: Parameters<SupportRequestRepository["create"]>[0]): Promise<void> {
    await this.client.supportRequest.create({ data: { ...record, createdAt: new Date(record.createdAt) } });
  }
}
