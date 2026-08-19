import { describe, expect, it, vi } from "vitest";
import type { ReplayJobRepository, ReplaySource } from "./ports";
import { ProcessReplayJob } from "./process-replay-job";
import { validBundle } from "../test/fixtures";

function source(dispose = vi.fn(async () => undefined)): ReplaySource {
  return {
    filename: "match.replay",
    path: "/tmp/match.replay",
    contentHash: "hash",
    createdBy: "owner",
    dispose,
  };
}

function jobs(): ReplayJobRepository {
  return {
    create: vi.fn(),
    setStatus: vi.fn(),
    complete: vi.fn(),
    fail: vi.fn(),
    get: vi.fn(),
  };
}

describe("ProcessReplayJob", () => {
  it("returns after persistence without waiting for processing", async () => {
    let finish!: () => void;
    const processing = new Promise<void>(resolve => { finish = resolve; });
    const repository = jobs();
    const processReplay = { execute: vi.fn(async () => {
      await processing;
      return validBundle();
    }) };
    const service = new ProcessReplayJob({ processReplay, jobs: repository, createId: () => "job-id", now: () => new Date(0) });

    await expect(service.submit(source())).resolves.toBe("job-id");
    expect(repository.create).toHaveBeenCalledOnce();
    expect(repository.complete).not.toHaveBeenCalled();

    finish();
    await vi.waitFor(() => expect(repository.complete).toHaveBeenCalledWith("job-id", "owner", expect.anything(), expect.any(String)));
  });

  it("records processing failures", async () => {
    const repository = jobs();
    const service = new ProcessReplayJob({
      processReplay: { execute: vi.fn(async () => { throw new Error("Malformed replay."); }) },
      jobs: repository,
      createId: () => "job-id",
      now: () => new Date(0),
    });

    await service.submit(source());
    await vi.waitFor(() => expect(repository.fail).toHaveBeenCalledWith("job-id", "owner", "Malformed replay.", expect.any(String)));
  });
});
