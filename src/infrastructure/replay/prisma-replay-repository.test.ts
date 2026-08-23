import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { replayAnalysisBundleV2Schema } from "../../shared/contracts/replay-analysis-v2";
import { rrrocketReplaySchema } from "../../shared/contracts/rrrocket";
import { replayData, validBundle } from "../../test/fixtures";
import { PrismaReplayJobRepository } from "./prisma-replay-job-repository";
import { PrismaReplayRepository } from "./prisma-replay-repository";

describe("local Prisma persistence", () => {
  let directory: string;
  let client: PrismaClient;

  beforeAll(async () => {
    directory = await mkdtemp(resolve(tmpdir(), "replay-prisma-test-"));
    const databaseUrl = `file:${resolve(directory, "test.sqlite")}`;
    execFileSync(process.execPath, [resolve("node_modules/prisma/build/index.js"), "db", "push", "--skip-generate"], {
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: "ignore",
    });
    client = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  });

  afterAll(async () => {
    await client.$disconnect();
    await rm(directory, { recursive: true, force: true });
  });

  it("stores replay metadata in SQLite and replay data on the filesystem", async () => {
    const repository = new PrismaReplayRepository(client, resolve(directory, "replays"));
    const bundle = replayAnalysisBundleV2Schema.parse(validBundle());
    const replay = rrrocketReplaySchema.parse(replayData);
    await repository.publish({
      id: bundle.replay.id,
      contentHash: "a".repeat(64),
      createdBy: "local-user",
      filename: bundle.replay.filename,
      replay,
      bundle,
    });

    await expect(repository.getReplay(bundle.replay.id, "local-user")).resolves.toEqual(replay);
    await expect(repository.findBundleByHash("local-user", "a".repeat(64))).resolves.toEqual(bundle);
    await expect(repository.listReplays("local-user")).resolves.toEqual([{
      id: bundle.replay.id,
      filename: bundle.replay.filename,
      analyzedAt: bundle.analysis.generatedAt,
    }]);
    await expect(repository.deleteReplay(bundle.replay.id, "different-user")).resolves.toBe(false);
    await expect(repository.deleteReplay(bundle.replay.id, "local-user")).resolves.toBe(true);
    await expect(repository.getReplay(bundle.replay.id, "local-user")).resolves.toBeUndefined();
  });

  it("persists pollable processing jobs", async () => {
    const jobs = new PrismaReplayJobRepository(client);
    const bundle = replayAnalysisBundleV2Schema.parse(validBundle());
    await jobs.create({ id: "job-1", createdBy: "local-user", createdAt: new Date(0).toISOString() });
    await expect(jobs.get("job-1", "local-user")).resolves.toEqual({ jobId: "job-1", status: "queued" });
    await jobs.complete("job-1", "local-user", bundle, new Date(1).toISOString());
    await expect(jobs.get("job-1", "local-user")).resolves.toEqual({ jobId: "job-1", status: "completed", result: bundle });
  });
});
