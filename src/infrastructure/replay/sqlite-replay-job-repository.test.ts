import { afterEach, describe, expect, it } from "vitest";
import { validBundle } from "../../test/fixtures";
import { SqliteReplayJobRepository } from "./sqlite-replay-job-repository";

const repositories: SqliteReplayJobRepository[] = [];
afterEach(async () => Promise.all(repositories.splice(0).map(repository => repository.close())));

describe("SqliteReplayJobRepository", () => {
  it("persists status and completed results with owner isolation", async () => {
    const repository = new SqliteReplayJobRepository(":memory:");
    repositories.push(repository);
    await repository.create({ id: "job-id", createdBy: "owner", createdAt: "2026-08-19T00:00:00.000Z" });
    expect(await repository.get("job-id", "other-owner")).toBeUndefined();
    expect(await repository.get("job-id", "owner")).toEqual({ jobId: "job-id", status: "queued" });

    await repository.setStatus("job-id", "owner", "processing", "2026-08-19T00:01:00.000Z");
    expect(await repository.get("job-id", "owner")).toEqual({ jobId: "job-id", status: "processing" });

    await repository.complete("job-id", "owner", validBundle(), "2026-08-19T00:02:00.000Z");
    expect(await repository.get("job-id", "owner")).toMatchObject({
      jobId: "job-id",
      status: "completed",
      result: { schemaVersion: 2 },
    });
  });

  it("persists a failed terminal state", async () => {
    const repository = new SqliteReplayJobRepository(":memory:");
    repositories.push(repository);
    await repository.create({ id: "job-id", createdBy: "owner", createdAt: "2026-08-19T00:00:00.000Z" });
    await repository.fail("job-id", "owner", "Malformed replay.", "2026-08-19T00:01:00.000Z");
    expect(await repository.get("job-id", "owner")).toEqual({ jobId: "job-id", status: "failed", error: "Malformed replay." });
  });
});
