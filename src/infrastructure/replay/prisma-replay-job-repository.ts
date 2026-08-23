import type { PrismaClient } from "@prisma/client";
import type { ReplayJobRepository } from "../../application/ports";
import { replayJobSchema, type ReplayJob, type ReplayJobStatus } from "../../shared/contracts/replay-job";
import type { ReplayAnalysisBundleV2 } from "../../shared/contracts/replay-analysis-v2";

export class PrismaReplayJobRepository implements ReplayJobRepository {
  constructor(private readonly client: PrismaClient) {}

  async create(record: { id: string; createdBy: string; createdAt: string }): Promise<void> {
    await this.client.replayJob.create({ data: {
      id: record.id,
      createdBy: record.createdBy,
      status: "queued",
      createdAt: new Date(record.createdAt),
      updatedAt: new Date(record.createdAt),
    } });
  }

  async setStatus(id: string, createdBy: string, status: ReplayJobStatus, updatedAt: string): Promise<void> {
    await this.client.replayJob.updateMany({
      where: { id, createdBy },
      data: { status, result: null, error: null, updatedAt: new Date(updatedAt) },
    });
  }

  async complete(id: string, createdBy: string, result: ReplayAnalysisBundleV2, updatedAt: string): Promise<void> {
    await this.client.replayJob.updateMany({
      where: { id, createdBy },
      data: { status: "completed", result: JSON.stringify(result), error: null, updatedAt: new Date(updatedAt) },
    });
  }

  async fail(id: string, createdBy: string, error: string, updatedAt: string): Promise<void> {
    await this.client.replayJob.updateMany({
      where: { id, createdBy },
      data: { status: "failed", result: null, error, updatedAt: new Date(updatedAt) },
    });
  }

  async get(id: string, createdBy: string): Promise<ReplayJob | undefined> {
    const row = await this.client.replayJob.findFirst({ where: { id, createdBy } });
    if (!row) return undefined;
    if (row.status === "completed") return replayJobSchema.parse({ jobId: row.id, status: row.status, result: JSON.parse(row.result ?? "null") });
    if (row.status === "failed") return replayJobSchema.parse({ jobId: row.id, status: row.status, error: row.error ?? "Replay processing failed." });
    return replayJobSchema.parse({ jobId: row.id, status: row.status });
  }
}
