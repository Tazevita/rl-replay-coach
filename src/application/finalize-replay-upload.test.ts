import { describe, expect, it, vi } from "vitest";
import type { ReplayRepository } from "./ports";
import { FinalizeReplayUpload } from "./finalize-replay-upload";
import { replayData, validBundle } from "../test/fixtures";

describe("FinalizeReplayUpload", () => {
  it("validates Lambda outputs and publishes the completed bundle", async () => {
    const source = validBundle();
    const repository = {
      findBundleByHash: vi.fn(async () => undefined),
      listReplays: vi.fn(async () => []),
      publish: vi.fn(async record => record.bundle),
    } as unknown as ReplayRepository;
    const outputs = {
      read: vi.fn(async (key: string) => key.includes("parsed")
        ? replayData
        : { schemaVersion: 1, teams: source.analysis.teams, playerPredictions: source.analysis.playerPredictions }),
    };
    const finalizer = new FinalizeReplayUpload({
      repository,
      outputs,
      createId: () => "replay-id",
      now: () => new Date("2026-08-19T00:00:00.000Z"),
      modelVersion: "model-v1",
    });

    const result = await finalizer.execute({
      createdBy: "owner",
      filename: "match.replay",
      contentHash: "hash",
      parsedObjectKey: "jobs/job/parsed/replay.json",
      analysisObjectKey: "jobs/job/analysis/replay.json",
    });

    expect(result.replay).toMatchObject({ id: "replay-id", filename: "match.replay", dataUrl: "/api/replays/replay-id/data" });
    expect(result.analysis).toMatchObject({ provider: "aws-lambda-replay-analysis", modelVersion: "model-v1" });
    expect(repository.publish).toHaveBeenCalledWith(expect.objectContaining({ replayObjectKey: "jobs/job/parsed/replay.json" }));
  });

  it("does not read Lambda outputs when the creator is at the replay limit", async () => {
    const repository = {
      findBundleByHash: vi.fn(async () => undefined),
      listReplays: vi.fn(async () => Array.from({ length: 50 }, (_, index) => ({
        id: `replay-${index}`,
        filename: `match-${index}.replay`,
        analyzedAt: "2026-08-19T00:00:00.000Z",
      }))),
      publish: vi.fn(),
    } as unknown as ReplayRepository;
    const outputs = { read: vi.fn() };
    const finalizer = new FinalizeReplayUpload({
      repository,
      outputs,
      createId: () => "replay-id",
      now: () => new Date("2026-08-19T00:00:00.000Z"),
    });

    await expect(finalizer.execute({
      createdBy: "owner",
      filename: "match.replay",
      contentHash: "hash",
      parsedObjectKey: "jobs/job/parsed/replay.json",
      analysisObjectKey: "jobs/job/analysis/replay.json",
    })).rejects.toThrow("You can store up to 50 replays");
    expect(outputs.read).not.toHaveBeenCalled();
    expect(repository.publish).not.toHaveBeenCalled();
  });

  it("surfaces a deterministic Lambda analysis failure", async () => {
    const repository = {
      findBundleByHash: vi.fn(async () => undefined),
      listReplays: vi.fn(async () => []),
      publish: vi.fn(),
    } as unknown as ReplayRepository;
    const finalizer = new FinalizeReplayUpload({
      repository,
      outputs: { read: vi.fn(async (key: string) => key.includes("analysis")
        ? { status: "failed", error: "this experiment requires a 2v2 replay; replay TeamSize is 3" }
        : replayData) },
      createId: () => "replay-id",
      now: () => new Date("2026-08-19T00:00:00.000Z"),
    });

    await expect(finalizer.execute({
      createdBy: "owner",
      filename: "threes.replay",
      contentHash: "hash",
      parsedObjectKey: "jobs/job/parsed/replay.json",
      analysisObjectKey: "jobs/job/analysis/replay.json",
    })).rejects.toThrow("this experiment requires a 2v2 replay; replay TeamSize is 3");
    expect(repository.publish).not.toHaveBeenCalled();
  });
});
