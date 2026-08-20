import { describe, expect, it, vi } from "vitest";
import { validBundle } from "../../test/fixtures";
import { HttpReplayProcessingGateway } from "./replay-processing-gateway";

describe("HttpReplayProcessingGateway", () => {
  it("polls an accepted job until it completes", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        jobId: "job-id", status: "uploading", statusUrl: "/api/replay-jobs/job-id",
        dispatchUrl: "/api/replay-jobs/job-id/dispatch", uploadUrl: "https://uploads.example/job-id",
        uploadHeaders: { "content-type": "application/octet-stream" },
      }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ jobId: "job-id", status: "processing" }), { status: 202 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ jobId: "job-id", status: "processing" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ jobId: "job-id", status: "completed", result: validBundle() }), { status: 200 }));
    const upload = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    const result = await new HttpReplayProcessingGateway(0, async () => undefined, request, upload)
      .process({ name: "match.replay", content: new Blob(["replay"]) });
    expect(result.schemaVersion).toBe(2);
    expect(result.analysis.playerPredictions.players[0].displayName).toBe("Alpha");
    expect(request).toHaveBeenCalledTimes(4);
    expect(request).toHaveBeenLastCalledWith("/api/replay-jobs/job-id");
    expect(upload).toHaveBeenCalledWith("https://uploads.example/job-id", expect.objectContaining({ method: "PUT" }));
  });

  it("surfaces a failed job", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        jobId: "job-id", status: "uploading", statusUrl: "/api/replay-jobs/job-id",
        dispatchUrl: "/api/replay-jobs/job-id/dispatch", uploadUrl: "https://uploads.example/job-id", uploadHeaders: {},
      }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ jobId: "job-id", status: "processing" }), { status: 202 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ jobId: "job-id", status: "failed", error: "Replay is malformed." }), { status: 200 }));
    const upload = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    await expect(new HttpReplayProcessingGateway(0, async () => undefined, request, upload)
      .process({ name: "match.replay", content: new Blob(["replay"]) }))
      .rejects.toThrow("Replay is malformed.");
  });

  it("falls back to the local streamed upload endpoint", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "Unavailable." }), { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ jobId: "local-job", status: "queued", statusUrl: "/api/replay-jobs/local-job" }), { status: 202 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ jobId: "local-job", status: "completed", result: validBundle() }), { status: 200 }));

    await expect(new HttpReplayProcessingGateway(0, async () => undefined, request)
      .process({ name: "match.replay", content: new Blob(["replay"]) }))
      .resolves.toMatchObject({ schemaVersion: 2 });
    expect(request).toHaveBeenNthCalledWith(2, "/api/replays", expect.objectContaining({ method: "POST" }));
  });
});
