import { afterEach, describe, expect, it, vi } from "vitest";
import { validBundle } from "../../test/fixtures";
import { HttpReplayProcessingGateway } from "./replay-processing-gateway";

afterEach(() => vi.unstubAllGlobals());

describe("HttpReplayProcessingGateway", () => {
  it("polls an accepted job until it completes", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ jobId: "job-id", status: "queued", statusUrl: "/api/replay-jobs/job-id" }), { status: 202 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ jobId: "job-id", status: "processing" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ jobId: "job-id", status: "completed", result: validBundle() }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const result = await new HttpReplayProcessingGateway(0, async () => undefined).process({ name: "match.replay", content: new Uint8Array() });
    expect(result.schemaVersion).toBe(2);
    expect(result.analysis.playerPredictions.players[0].displayName).toBe("Alpha");
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch).toHaveBeenLastCalledWith("/api/replay-jobs/job-id");
  });

  it("surfaces a failed job", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ jobId: "job-id", status: "queued", statusUrl: "/api/replay-jobs/job-id" }), { status: 202 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ jobId: "job-id", status: "failed", error: "Replay is malformed." }), { status: 200 })));
    await expect(new HttpReplayProcessingGateway(0, async () => undefined).process({ name: "match.replay", content: new Uint8Array() }))
      .rejects.toThrow("Replay is malformed.");
  });
});
